import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useRef, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { TypeSearchBadge } from '../kit/TypeSearchBadge.tsx';
import { createSnapshotSlot } from '../nav/navHistory.ts';
import type { PageProps } from '../nav/places.ts';
import { discTrackText } from '../table/cellText.ts';
import { countRows, rowsOf, sameRanges, type SelectionRanges } from '../table/rangeSelection.ts';
import type { TableGroupItem, TablePoint, TableTrack } from '../table/tableItems.ts';
import { TrackTable, type TableGroupState, type TrackTableHandle } from '../table/TrackTable.tsx';
import { useTableSnapshot, type TableView } from '../table/useTableSnapshot.ts';
import type { TableMenuTarget } from '../table/useTrackTableInput.ts';
import { PlaylistConditions } from './filter/PlaylistConditions.tsx';
import { PlaylistGroupHead } from './groups/PlaylistGroupHead.tsx';
import { PlaylistHitsMenu } from './filter/PlaylistHitsMenu.tsx';
import { sameConditions, type PlaylistCondition } from './filter/playlistMatch.ts';
import styles from './PlaylistPage.module.css';
import { PlaylistPageHeader } from './PlaylistPageHeader.tsx';
import { PlaylistPageNotices } from './PlaylistPageNotices.tsx';
import { PlaylistTrackMenu, type PlaylistMenuTarget } from './PlaylistTrackMenu.tsx';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';
import type { PlaylistGroupHead as HeadData } from './playlistView.ts';
import { GROUP_HEIGHT, ROW_HEIGHT, usePlaylistPage } from './usePlaylistPage.ts';
import { usePlaylistPageKeys } from './usePlaylistPageKeys.ts';
import { usePlaylistReveal } from './usePlaylistReveal.ts';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';
import { playlistActionsKey } from './playlistActions.ts';

/** 离开时记下滚动、焦点行、过滤词与条件。 */
const PLAYLIST_SLOT =
  createSnapshotSlot<
    TableView<{ readonly query: string; readonly conditions: readonly PlaylistCondition[] }>
  >();
/** 序号格：有碟号写「碟.曲」，没有只写两位曲号。列表里的曲目来自不同专辑，不按碟数定写法。 */
const numberText = (track: TableTrack) => {
  const padded = discTrackText(track, 1);
  return padded && track.discNumber > 0 ? `${track.discNumber}.${padded}` : padded;
};
const groupHeight = () => GROUP_HEIGHT;
/** 按专辑分组的两档（`GROUP_MODES` 的前两项）：组头写专辑名、专辑艺术家与年份。 */
const ALBUM_MODES = new Set([0, 1]);

/** 播放列表页：主体是列表的 GUID。换一张列表就是另一页，里面的状态从头来。 */
export function PlaylistPage({ place }: PageProps) {
  const guid = place.subject ?? '';
  return <PlaylistPageBody key={guid} guid={guid} />;
}

/**
 * 一张播放列表：页头、条件行与横幅在上，一直留着，滚到哪里过滤框与 ⋯ 都够得着；下面整宽的曲目表，行在
 * 表格自己的滚动区里滚，列头不动。行按视口分页取；分组开着时组头与行混排，组头下挂封面；过滤时只列命中的
 * 行。选中与宿主同步，双击、回车从那一行起播。
 */
function PlaylistPageBody({ guid }: { readonly guid: string }) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const store = useStore();
  const page = useService(playlistPageKey);
  const playlistActions = useService(playlistActionsKey);
  const model = usePlaylistPage(guid);
  const { view, rows, filter, entry } = model;
  const selected = useAtomValueRawSync(model.selection.state);
  const [menu, setMenu] = useState<PlaylistMenuTarget | null>(null);
  const handle = useRef<TrackTableHandle>(null);
  const tableBox = useRef<HTMLDivElement>(null);
  const { typeSearch } = usePlaylistReveal(guid, model, handle);
  usePlaylistPageKeys(guid, {
    // 焦点在表格根上才算：列头的按钮也在表格里，焦点在那儿时 Delete、撤销这几条不认。
    focused: () => {
      const active = document.activeElement;
      return active?.getAttribute('role') === 'treegrid' && !!tableBox.current?.contains(active);
    },
    // 锁着、行或第一份游程还没到、本地一行都没选时不删：宿主那份此刻未必是用户看到的那一批。
    canRemove: () =>
      !(entry?.isLocked ?? true) &&
      rows.status === 'ready' &&
      model.latest().shape !== 'waiting' &&
      countRows(store.get(model.selection.state).ranges) > 0,
    typeSearch,
    onHistory: model.resetSort,
  });

  useTableSnapshot(PLAYLIST_SLOT, {
    handle,
    items: view.items,
    ready: rows.status === 'ready' && view.shape !== 'waiting',
    extra: () => ({ query: filter.query, conditions: filter.conditions }),
    apply({ query, conditions }) {
      if (query.trim() !== '' || conditions.length > 0)
        page.filter.restore(guid, query, conditions);
    },
    // 扫描落地了、落的正是快照里的那一份，行才排好。
    matches: ({ query, conditions }) =>
      !filter.scanning &&
      filter.term === query.trim() &&
      sameConditions(filter.conditions, conditions),
  });

  const groupAt = (index: number) => {
    const item = model.latest().items[index];
    return item?.kind === 'group' ? item : undefined;
  };
  /** 开合一级组；给了 `collapsed` 时只在它还不是那个状态时开合。 */
  const toggle = (index: number, collapsed?: boolean) => {
    const group = groupAt(index);
    if (group?.data.level !== 1 || group.collapsed === collapsed) return;
    page.groups.toggleCollapsed(guid, group.data.key);
  };
  const openMenu = (target: TableMenuTarget, at: TablePoint) => {
    const item = model.latest().items[target.index];
    const { contentVersion } = rows;
    const open = (ranges: SelectionRanges, row: number) => {
      if (countRows(ranges) > SEND_TO_INLINE_LIMIT) {
        setMenu({ at, ranges, row, contentVersion, ratingTracks: null });
        return;
      }
      const picked = rowsOf(ranges).map((order) => ({
        track: view.trackOf(order),
        stamp: view.stampOf({ kind: 'row', key: `r${order}`, order, track: view.trackOf(order) }),
      }));
      const tracks = picked.flatMap(({ track }) => track ?? []);
      setMenu({
        at,
        ranges,
        row,
        contentVersion,
        ratingTracks:
          tracks.length === picked.length
            ? { tracks, stamps: picked.map(({ stamp }) => stamp) }
            : null,
      });
    };
    if (target.kind === 'rows' && item?.kind === 'row') {
      open(target.rows, item.order);
    } else if (item?.kind === 'group' && !item.data.pending) {
      // 分组头的菜单作用于整组，折起来看不见的行也算。游程在重取时组的起止可能已经对不上行，不开。
      const { start, count } = item.data;
      model.selection.replace([{ start, end: start + count }]);
      open([{ start, end: start + count }], start);
    } else return;
    void page.menu.prepare(guid);
  };
  // 菜单开着时列表增删重排了：它记的行号已经指着别的曲目，收起来，不按旧行号执行。
  if (
    menu &&
    (menu.contentVersion !== rows.contentVersion || !sameRanges(menu.ranges, selected.ranges))
  )
    setMenu(null);
  const albumMode = ALBUM_MODES.has(model.prefs.mode);
  const renderGroup = useCallback(
    (item: TableGroupItem<HeadData>, state: TableGroupState) => (
      <PlaylistGroupHead
        guid={guid}
        item={item}
        state={state}
        albumMode={albumMode}
        coverWidth={model.coverWidth}
        covers={page.covers}
        t={t}
        plural={plural}
      />
    ),
    [guid, albumMode, model.coverWidth, page.covers, t, plural],
  );

  const empty =
    view.shape === 'filtered' ? (
      <div className={styles.empty} data-playlist-empty="noMatch">
        {filter.term !== ''
          ? t('playlistPage.noMatch', { term: filter.term })
          : t('playlistPage.noMatchConditions')}
      </div>
    ) : entry?.isAutoplaylist && rows.status === 'ready' ? (
      <div className={styles.empty} data-playlist-empty="auto">
        {t('playlistPage.autoEmpty')}
      </div>
    ) : undefined;
  const gone = rows.status === 'gone' || rows.status === 'disconnected';

  return (
    <section
      className={styles.root}
      aria-label={entry?.name ?? t('place.playlist')}
      data-page="playlist"
    >
      <div className={styles.body}>
        <div className={styles.top} data-playlist-toolbar>
          <PlaylistPageHeader guid={guid} entry={entry} total={rows.total} filter={filter}>
            <PlaylistHitsMenu guid={guid} model={model} />
          </PlaylistPageHeader>
          <PlaylistConditions guid={guid} conditions={filter.conditions} />
          <PlaylistPageNotices guid={guid} model={model} />
        </div>
        {!gone && (
          <div ref={tableBox} className={styles.table}>
            <TrackTable
              handle={handle}
              columns={model.columns}
              items={view.items}
              selection={model.selection}
              label={t('playlistPage.table')}
              rowHeight={ROW_HEIGHT}
              groupHeight={groupHeight}
              renderGroup={renderGroup}
              animateGroupFold={(item) => item.data.level === 1}
              ratingStamp={view.stampOf}
              numberText={numberText}
              sort={model.sort}
              onSort={model.onSort}
              columnMenu={model.columnMenu}
              onRange={model.onRange}
              typeSearch={typeSearch}
              loading={rows.status !== 'ready' || view.shape === 'waiting' || filter.scanning}
              empty={empty}
              onPlay={(index) => {
                const item = model.latest().items[index];
                if (item?.kind === 'row') void playlistActions.play(guid, item.order);
              }}
              onMenu={openMenu}
              onGroupClick={(_, __, toggle) => toggle()}
              onToggleGroup={(index) => toggle(index)}
              onSetGroup={(index, collapsed) => toggle(index, collapsed)}
              onExpandSiblings={() => page.groups.expandAll(guid)}
            />
          </div>
        )}
      </div>
      {typeSearch && (
        <div className={styles.badge}>
          <TypeSearchBadge search={typeSearch} />
        </div>
      )}
      <PlaylistTrackMenu
        guid={guid}
        target={menu}
        view={view}
        total={rows.total}
        onClose={() => setMenu(null)}
        isCurrent={() => !!menu && sameRanges(menu.ranges, store.get(model.selection.state).ranges)}
      />
    </section>
  );
}
