import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { TypeSearchBadge } from '../kit/TypeSearchBadge.tsx';
import { createSnapshotSlot } from '../nav/navHistory.ts';
import type { PageProps } from '../nav/places.ts';
import { discTrackText } from '../table/cellText.ts';
import { countRows, rowsOf, sameRanges, type SelectionRanges } from '../table/rangeSelection.ts';
import type { TableArtwork, TableGroupItem, TablePoint, TableTrack } from '../table/tableItems.ts';
import { TrackTable, type TableGroupState, type TrackTableHandle } from '../table/TrackTable.tsx';
import { useTableSnapshot, type TableView } from '../table/useTableSnapshot.ts';
import type { TableMenuTarget } from '../table/useTrackTableInput.ts';
import { trackFilterOf } from './filter/playlistFilter.ts';
import { PlaylistGroupHead } from './groups/PlaylistGroupHead.tsx';
import { PlaylistMoreMenu } from './PlaylistMoreMenu.tsx';
import { fb } from 'foo-webview-sdk/bridge';
import { ConditionEditor } from '../track/ConditionEditor.tsx';
import { FilterConditions } from '../track/FilterConditions.tsx';
import { FilterSurface, useFilterSurface } from '../track/FilterSurface.tsx';
import { filterConditions } from '../track/filterLabels.ts';
import { PresetChips } from '../track/PresetChips.tsx';
import { queryInputText } from '../track/queryInput.ts';
import { trackFacetCount } from '../track/trackFacets.ts';
import { sameTrackFilter, type TrackFilter } from '../track/trackFilter.ts';
import { PlaylistFacets } from './filter/PlaylistFacets.tsx';
import { SelectionBar } from '../track/SelectionBar.tsx';
import { trackActionsKey } from '../track/trackActions.ts';
import { LIBRARY_SOURCE } from '../playback/playbackSource.ts';
import { playPlaylistSelection } from './playPlaylistSelection.ts';
import styles from './PlaylistPage.module.css';
import { COMMAND_BAR_TIERS, type CommandBarTier } from '../kit/CommandBar.tsx';
import { useWidthTier } from '../kit/useWidthTier.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { AutoplaylistEditButton } from './PlaylistAutoplaylistEdit.tsx';
import { PlaylistPageHeader } from './PlaylistPageHeader.tsx';
import { PlaylistViewPanel } from './PlaylistViewPanel.tsx';
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
import { playlistRowsKey } from './playlistRows.ts';

/** 离开时记下滚动、焦点行与筛选（搜索框的输入含模式与两份草稿，以及预设与条件）；筛选只活在这条历史记录里 */
const PLAYLIST_SLOT = createSnapshotSlot<TableView<TrackFilter>>();
/** 序号格：有碟号写「碟.曲」，没有只写两位曲号。列表里的曲目来自不同专辑，不按碟数定写法 */
const numberText = (track: TableTrack) => {
  const padded = discTrackText(track, 1);
  return padded && track.discNumber > 0 ? `${track.discNumber}.${padded}` : padded;
};
const groupHeight = () => GROUP_HEIGHT;
/** 按专辑分组的两档（`GROUP_MODES` 的前两项）：组头写专辑名、专辑艺术家与年份 */
const ALBUM_MODES = new Set([0, 1]);

export interface PlaylistPageProps extends PageProps {
  /** 不分组时缩略图列每行的画法；不给就不画 */
  readonly artwork?: TableArtwork;
  /** 装没装 foo_playcount，由装配层告知；null 是还没探出来 */
  readonly playcount?: boolean | null;
}

/** 播放列表页：主体是列表的 GUID。换一张列表就是另一页，里面的状态从头来 */
export function PlaylistPage({ place, artwork, playcount = null }: PlaylistPageProps) {
  const guid = place.subject ?? '';
  return <PlaylistPageBody key={guid} guid={guid} artwork={artwork} playcount={playcount} />;
}

/**
 * 一张播放列表：页头、条件行与横幅在上，一直留着，滚到哪里过滤框与 ⋯ 都够得着；下面整宽的曲目表，行在
 * 表格自己的滚动区里滚，列头不动。行按视口分页取；分组开着时组头与行混排，组头下挂封面；过滤时只列命中的
 * 行。选中与宿主同步，双击、回车从那一行起播
 */
function PlaylistPageBody({
  guid,
  artwork,
  playcount,
}: {
  readonly guid: string;
  readonly artwork: TableArtwork | undefined;
  readonly playcount: boolean | null;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const store = useStore();
  const page = useService(playlistPageKey);
  const playlistActions = useService(playlistActionsKey);
  const playlistRows = useService(playlistRowsKey);
  const trackActions = useService(trackActionsKey);
  const model = usePlaylistPage(guid);
  const { view, rows, filter, entry } = model;
  const controls = useViewControlStyles();
  const [measure, tier] = useWidthTier<CommandBarTier, HTMLDivElement>(COMMAND_BAR_TIERS);
  const surfacePrefs = useAtomValueRawSync(page.filter.surface.atom);
  const surface = useFilterSurface({
    docked: surfacePrefs.docked,
    expanded: surfacePrefs.expanded,
    narrow: tier === 'narrow',
    onDock: page.filter.surface.setDocked,
    onExpand: page.filter.surface.setExpanded,
  });
  const trackFilter = trackFilterOf(filter);
  const conditionCount = filterConditions(trackFilter, t).length;
  const selected = useAtomValueRawSync(model.selection.state);
  const [menu, setMenu] = useState<PlaylistMenuTarget | null>(null);
  const [selectionPlayFailed, setSelectionPlayFailed] = useState(false);
  const playAttempt = useRef(0);
  useEffect(
    () => () => {
      playAttempt.current += 1;
    },
    [],
  );
  const handle = useRef<TrackTableHandle>(null);
  const tableBox = useRef<HTMLDivElement>(null);
  const { typeSearch } = usePlaylistReveal(guid, model, handle);
  usePlaylistPageKeys(guid, {
    // 焦点在表格根上才算：列头的按钮也在表格里，焦点在那儿时 Delete、撤销这几条不认
    focused: () => {
      const active = document.activeElement;
      return active?.getAttribute('role') === 'treegrid' && !!tableBox.current?.contains(active);
    },
    // 锁着、行或第一份游程还没到、本地一行都没选时不删：宿主那份此刻未必是用户看到的那一批
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
    extra: () => trackFilter,
    apply(saved) {
      if (
        queryInputText(saved).trim() !== '' ||
        saved.presets.size > 0 ||
        trackFacetCount(saved.facets) > 0 ||
        saved.conditions.length > 0
      )
        page.filter.restore(guid, saved);
    },
    // 求值落地了、落的正是快照里的那一份，行才排好
    matches: (saved) =>
      !filter.scanning &&
      filter.term === queryInputText(saved).trim() &&
      sameTrackFilter(trackFilter, saved),
  });

  const groupAt = (index: number) => {
    const item = model.latest().items[index];
    return item?.kind === 'group' ? item : undefined;
  };
  /** 开合一级组；给了 `collapsed` 时只在它还不是那个状态时开合 */
  const toggle = (index: number, collapsed?: boolean) => {
    const group = groupAt(index);
    if (group?.data.level !== 1 || group.collapsed === collapsed) return;
    page.groups.toggleCollapsed(guid, group.data.key);
  };
  /** 在 `at` 打开这批行的曲目菜单；`row` 是点到的那一行，菜单标题与「转到专辑」按它 */
  const openRows = (ranges: SelectionRanges, row: number, at: TablePoint) => {
    const { contentVersion } = rows;
    if (countRows(ranges) > SEND_TO_INLINE_LIMIT) {
      setMenu({ at, ranges, row, contentVersion, ratingTracks: null });
    } else {
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
    }
    void page.menu.prepare(guid);
  };
  const openMenu = (target: TableMenuTarget, at: TablePoint) => {
    const item = model.latest().items[target.index];
    if (target.kind === 'rows' && item?.kind === 'row') {
      openRows(target.rows, item.order, at);
    } else if (item?.kind === 'group' && !item.data.pending) {
      // 分组头的菜单作用于整组，折起来看不见的行也算。游程在重取时组的起止可能已经对不上行，不开
      const { start, count } = item.data;
      model.selection.replace([{ start, end: start + count }]);
      openRows([{ start, end: start + count }], start, at);
    }
  };
  // 选区操作按点下那一刻的选中项执行；列表在执行前改过、选区变了就不再执行
  const chosen = () => store.get(model.selection.state).ranges;
  const playChosen = async () => {
    const attempt = ++playAttempt.current;
    const ranges = chosen();
    const version = store.get(playlistRows.stateOf(guid)).contentVersion;
    const current = () =>
      attempt === playAttempt.current &&
      sameRanges(chosen(), ranges) &&
      store.get(playlistRows.stateOf(guid)).contentVersion === version;
    const ok = await playPlaylistSelection(fb, guid, ranges, current, (paths) =>
      trackActions.playPaths(paths, 0, LIBRARY_SOURCE),
    );
    if (current()) setSelectionPlayFailed(!ok);
  };
  const selectedCount = countRows(selected.ranges);
  const selection = (labelled: boolean) =>
    selectedCount > 1 && (
      <SelectionBar
        count={selectedCount}
        labelled={labelled}
        inlineLimited={selectedCount > SEND_TO_INLINE_LIMIT}
        sourcePlaylist={guid}
        handlers={{
          play: () => {
            void playChosen();
          },
          next: () => void page.tracks.queueNext(guid, chosen()),
          enqueue: () => void page.tracks.queueLast(guid, chosen()),
          sendToNew: () => {
            const ranges = chosen();
            const first = view.trackOf(ranges[0]?.start ?? -1);
            const name = t('trackMenu.batchName', {
              first: first?.title ?? '',
              count: countRows(ranges),
              rest: Math.max(0, countRows(ranges) - 1),
            });
            void page.tracks.sendToNew(guid, ranges, name);
          },
          sendTo: (into) => void page.tracks.sendTo(guid, chosen(), into.guid),
        }}
        onClear={() => model.selection.clear()}
        onMore={(point) => {
          const ranges = chosen();
          const row = ranges[0]?.start;
          if (row !== undefined) openRows(ranges, row, point);
        }}
      />
    );
  // 菜单开着时列表增删重排了：它记的行号已经指着别的曲目，收起来，不按旧行号执行
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
  const hits = filter.hits.length;
  const gone = rows.status === 'gone' || rows.status === 'disconnected';
  // 过滤时眼前第一行是第一个命中，从它起播
  const first = view.items.find((item) => item.kind === 'row');
  const play =
    rows.status === 'ready' && first?.kind === 'row'
      ? () => void playlistActions.play(guid, first.order)
      : null;

  return (
    <section
      className={styles.root}
      aria-label={entry?.name ?? t('place.playlist')}
      data-page="playlist"
    >
      <div className={styles.body}>
        <div ref={measure} className={styles.top} data-playlist-toolbar>
          <PlaylistPageHeader
            guid={guid}
            entry={entry}
            total={rows.total}
            filter={filter}
            play={play}
            selection={selection}
            tier={tier}
            surface={surface}
            conditions={conditionCount}
            playcount={playcount}
            view={(labelled) => (
              <PlaylistViewPanel
                groups={model.listMenu.groups}
                columns={model.columns}
                labelled={labelled}
                filtering={filter.active}
              />
            )}
          >
            <AutoplaylistEditButton entry={entry} />
            <PlaylistMoreMenu guid={guid} model={model} reorder={model.listMenu.reorder} />
          </PlaylistPageHeader>
          <FilterSurface
            id="playlist"
            state={surface}
            footer={
              <>
                <ConditionEditor
                  playcount={playcount}
                  onAdd={(condition) => page.filter.addCondition(guid, condition)}
                />
                <span className={styles.result}>
                  {filter.active &&
                    t(plural(hits, 'playlistPage.matchCountOne', 'playlistPage.matchCount'), {
                      count: hits,
                    })}
                  <Button
                    size="small"
                    appearance="subtle"
                    className={controls.icon}
                    disabled={conditionCount === 0}
                    onClick={() => page.filter.clearConditions(guid)}
                  >
                    {t('playlistPage.conditionsClear')}
                  </Button>
                </span>
              </>
            }
          >
            <PresetChips
              checked={filter.presets}
              playcount={playcount}
              onToggle={(id) => page.filter.togglePreset(guid, id)}
            />
            <PlaylistFacets guid={guid} filter={trackFilter} tabs={surface.narrow} />
          </FilterSurface>
          <FilterConditions
            filter={trackFilter}
            playcount={playcount}
            hideWhenEmpty={!(surface.docked && surface.open)}
            onAdd={(condition) => page.filter.addCondition(guid, condition)}
            onClear={() => page.filter.clearConditions(guid)}
            onRemove={({ ref }) => {
              if (ref.kind === 'preset') page.filter.togglePreset(guid, ref.id);
              else if (ref.kind === 'condition') page.filter.removeCondition(guid, ref.key);
              else page.filter.toggleFacet(guid, ref.facet, ref.name);
            }}
          />
          <PlaylistPageNotices
            guid={guid}
            model={model}
            selectionPlay={{
              failed: selectionPlayFailed,
              dismiss: () => setSelectionPlayFailed(false),
            }}
          />
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
              artwork={artwork}
              sort={model.sort}
              onSort={model.onSort}
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
