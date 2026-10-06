import { Body1, Button, Subtitle2 } from '@fluentui/react-components';
import { Search32Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { trackNumberText } from '../../table/cellText.ts';
import { countRows, rowsOf, sameRanges } from '../../table/rangeSelection.ts';
import type { TableArtwork, TablePoint } from '../../table/tableItems.ts';
import { TrackTable, type TrackTableHandle } from '../../table/TrackTable.tsx';
import { useTableSnapshot, type TableView } from '../../table/useTableSnapshot.ts';
import type { TableMenuTarget } from '../../table/useTrackTableInput.ts';
import { albumsAtom } from '../albums.ts';
import { TrackMenu } from '../TrackMenu.tsx';
import { SongArt } from './SongArt.tsx';
import { SongsConditions } from './SongsConditions.tsx';
import { SongsFacets } from './SongsFacets.tsx';
import { songsFilterAtom, sameSongsFilter, type SongsFilter } from './songsFilter.ts';
import { SongsHeader } from './SongsHeader.tsx';
import { noMatchText } from './songsLabels.ts';
import { SongsNotices } from './SongsNotices.tsx';
import styles from './SongsPage.module.css';
import { songsPrefsAtom } from './songsPrefs.ts';
import { songsRowsAtom } from './songsRows.ts';
import { songsFillAtom, songsKey } from './songsServices.ts';
import { useDensityAnchor } from './useDensityAnchor.ts';
import { useSongsPage } from './useSongsPage.ts';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { AddFoldersAction } from '../AddFoldersAction.tsx';

/** 离开时记下滚动、焦点行与筛选（框里的字、预设与分面）；排序与列是落盘的偏好，不进快照。 */
const SONGS_SLOT = createSnapshotSlot<TableView<SongsFilter>>();

/**
 * 歌曲页：整库平铺成一张曲目表，按宿主排好的顺序显示。页头的过滤框按词或按 fb2k 查询筛，查询菜单里勾预设，分面条
 * 按流派、年代、艺术家筛；双击、回车从那一首起播，都由宿主按同一串查询填专用列表。
 */
export function SongsPage() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const songs = useService(songsKey);
  const albumList = useService(albumListKey);
  const prefs = useAtomValueRawSync(songsPrefsAtom);
  const { status: albumsStatus, enabled } = useAtomValueRawSync(albumsAtom);
  const model = useSongsPage();
  const { rows, library, filter, query, view, albumOf } = model;
  const { ranges } = useAtomValueRawSync(model.selection.state);
  const handle = useRef<TrackTableHandle>(null);
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const menuCurrent = useRef<() => boolean>(() => false);
  const [queryOpen, setQueryOpen] = useState(false);
  const artwork = useCallback<TableArtwork>(
    (track, size) => <SongArt album={albumOf(track)} size={size} />,
    [albumOf],
  );
  useDensityAnchor(handle, model.rowHeight);

  useTableSnapshot(SONGS_SLOT, {
    handle,
    items: model.items,
    ready: model.settled && rows.status !== 'loading',
    extra: () => store.get(songsFilterAtom),
    apply: (saved) => songs.filter.restore(saved),
    // 筛选换回去了、宿主按换回去的那一份答过了，行才排好。
    matches: (saved) => {
      const fill = store.get(songsFillAtom);
      const answered = rows.answered;
      return (
        sameSongsFilter(store.get(songsFilterAtom), saved) &&
        answered !== null &&
        answered.query === fill.query &&
        answered.sort === fill.sort &&
        answered.descending === fill.descending
      );
    },
  });

  const openMenu = (target: TableMenuTarget, at: TablePoint) => {
    if (target.kind !== 'rows') return;
    const tracks = rowsOf(target.rows).flatMap((row) => view.trackAt(row) ?? []);
    if (tracks.length === 0) return;
    const selection = target.rows;
    const generation = rows.generation;
    menuCurrent.current = () =>
      sameRanges(selection, store.get(model.selection.state).ranges) &&
      store.get(songsRowsAtom).generation === generation;
    void albumList.menu.prepare(tracks, view.trackAt(target.index), library.stamp);
    setMenuAt(at);
  };

  const empty =
    albumsStatus === 'ready' && !enabled ? (
      <div className={styles.empty} data-songs-empty="disabled">
        <Subtitle2>{t('album.disabledTitle')}</Subtitle2>
        <Body1 className={styles.detail}>{t('album.disabledDetail')}</Body1>
        <AddFoldersAction />
      </div>
    ) : !model.settled ? undefined : query.filtered ? (
      <div className={styles.empty} data-songs-empty="noMatch">
        <Search32Regular className={styles.emptyIcon} aria-hidden />
        <Subtitle2>{t('songs.noMatch')}</Subtitle2>
        <Body1 className={styles.detail}>{noMatchText(filter, t)}</Body1>
        <Button appearance="primary" size="small" onClick={() => songs.filter.clear()}>
          {t('songs.clearAll')}
        </Button>
      </div>
    ) : (
      <div className={styles.empty} data-songs-empty="empty">
        <Subtitle2>{t('songs.empty')}</Subtitle2>
        <AddFoldersAction />
      </div>
    );

  return (
    <section className={styles.root} aria-label={t('songs.title')} data-page="songs">
      <div className={styles.body}>
        <div className={styles.top}>
          <SongsHeader
            model={model}
            selected={countRows(ranges)}
            queryOpen={queryOpen}
            onQueryOpenChange={setQueryOpen}
          />
          {prefs.facetsOpen && <SongsFacets filter={filter} library={library} />}
          <SongsConditions filter={filter} />
          <SongsNotices model={model} />
        </div>
        <div className={styles.table}>
          <TrackTable
            handle={handle}
            columns={model.columns}
            items={model.items}
            selection={model.selection}
            label={t('songs.table')}
            rowHeight={model.rowHeight}
            ratingStamp={library.stamp}
            numberText={trackNumberText}
            sort={model.sort}
            onSort={model.onSort}
            links={model.links}
            artwork={artwork}
            loading={model.loading}
            empty={empty}
            rank={(item, needle) =>
              item.kind === 'row' && item.track?.title.toLocaleLowerCase().startsWith(needle)
                ? 0
                : undefined
            }
            onPlay={(index) => {
              const track = view.trackAt(index);
              if (track) void songs.actions.play(model.run, { row: index, handle: track.handle });
            }}
            onMenu={openMenu}
          />
        </div>
      </div>
      <TrackMenu
        at={menuAt}
        onClose={() => setMenuAt(null)}
        goToAlbum
        isCurrent={() => menuCurrent.current()}
      />
    </section>
  );
}
