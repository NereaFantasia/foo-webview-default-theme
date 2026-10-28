import { COLUMN_PREFS } from '../../table/columns/columnMigration.ts';
import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
} from '@fluentui/react-components';
import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import type { PageProps } from '../../nav/places.ts';
import { columnDef, type ColumnId } from '../../table/columns/columns.ts';
import { createColumnsModel } from '../../table/columns/columnsModel.ts';
import { rowsOf } from '../../table/rangeSelection.ts';
import { createRowSelection } from '../../table/rowSelection.ts';
import type { TableGroupItem, TablePoint } from '../../table/tableItems.ts';
import { TrackTable, type TrackTableHandle } from '../../table/TrackTable.tsx';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import { useTableSnapshot, type TableView } from '../../table/useTableSnapshot.ts';
import type { TableMenuTarget } from '../../table/useTrackTableInput.ts';
import { albumDetailsAtom, albumDetailKey } from './albumDetail.ts';
import { AlbumDetailHeader } from './AlbumDetailHeader.tsx';
import { DetailFrame } from '../detail/DetailFrame.tsx';
import { DetailTools } from '../detail/DetailTools.tsx';
import {
  buildDetailRows,
  DETAIL_SORT_FIELDS,
  detailNumberText,
  detailSort,
  detailSortField,
  filterDetailTracks,
  nextDetailSort,
  type DiscGroup,
} from './albumDetailItems.ts';
import styles from './AlbumDetailPage.module.css';
import { albumSource } from '../albumActions.ts';
import { AlbumMenu } from '../AlbumMenu.tsx';
import type { MenuPoint } from '../albumMenu.ts';
import { trackPathOf } from '../../host/libraryContract.ts';
import { TrackMenu } from '../TrackMenu.tsx';
import { AlbumColorTheme } from '../AlbumColorTheme.tsx';
import { useService } from '../../kit/useService.ts';
import { trackActionsKey, trackActionsNoticeAtom } from '../../track/trackActions.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { ratingsKey } from '../../track/trackRatings.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';

/** 列存档的键：详情页各张专辑共用一份 */
const COLUMNS_KEY = COLUMN_PREFS.albumDetail;
const OFFERED: readonly ColumnId[] = ['number', 'title', 'artist', 'rating', 'duration'];
const ROW_HEIGHT = 40;

interface DetailView {
  readonly sort: TableSort | null;
  readonly query: string;
}

/** 查找与排序随滚动一起恢复，否则原焦点可能不在恢复后的条目流里 */
const DETAIL_SLOT = createSnapshotSlot<TableView<DetailView>>();
const NO_TRACKS: readonly LibraryTrack[] = [];

const sameSort = (a: TableSort | null, b: TableSort | null) =>
  a === b || (a?.column === b?.column && a?.descending === b?.descending);

/**
 * 专辑详情页：头部在上，下面整宽的曲目表，整页一起滚，列头滚到顶时吸住。数据由详情服务取，页面挂上时
 * 登记要看这一张。列头单击就地排序，再点反向，点 # 回到碟、曲顺序；多碟专辑在碟、曲顺序下按碟分节
 * 这张不在媒体库了时留在这一页，写明原因
 */
export function AlbumDetailPage({ place }: PageProps) {
  const key = place.subject ?? '';
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const store = useStore();
  const trackActions = useService(trackActionsKey);
  const albumList = useService(albumListKey);
  const albumDetail = useService(albumDetailKey);
  const ratings = useService(ratingsKey);
  const detail = useAtomValueRawSync(albumDetailsAtom).get(key);
  const notice = useAtomValueRawSync(trackActionsNoticeAtom);
  useEffect(() => albumDetail.want(key), [albumDetail, key]);

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // 量到宽度之前是 null：头部的高随宽窄变，交还的滚动要等它定下来
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const [columns] = useState(() => createColumnsModel(store, { ...COLUMNS_KEY, offered: OFFERED }));
  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  const [sort, setSort] = useState<TableSort | null>(null);
  const [query, setQuery] = useState('');
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const [trackMenuAt, setTrackMenuAt] = useState<TablePoint | null>(null);
  const handle = useRef<TrackTableHandle>(null);

  const album = detail?.album ?? null;
  const tracks = detail?.tracks ?? NO_TRACKS;
  const loading = detail?.phase === 'loading';
  const discCount = useMemo(() => new Set(tracks.map((track) => track.discNumber)).size, [tracks]);
  const skeleton = loading ? (album?.trackCount ?? 0) : 0;
  const stamp = detail?.stamp ?? 0;
  const filtered = useMemo(() => filterDetailTracks(tracks, query), [tracks, query]);
  const rows = useMemo(
    () =>
      buildDetailRows(filtered, sort, discCount, skeleton, (track) =>
        ratings.ratingOf(track, stamp),
      ),
    [filtered, sort, discCount, skeleton, ratings, stamp],
  );
  const numberText = useMemo(() => detailNumberText(sort, discCount), [sort, discCount]);
  // 行序号换了（排序变了、曲目增删）才清空选中；库一变曲目重取，同样的曲目按同样的顺序回来时选中留着
  const order = rows.tracks.map((track) => track.handle).join('\n');
  useLayoutEffect(() => {
    selection.clear();
    selection.setTotal(order === '' ? 0 : order.split('\n').length);
  }, [selection, order]);

  // 交还：滚动与焦点等曲目到了、宽窄定了、排序也换成快照里的那一种再落
  useTableSnapshot(DETAIL_SLOT, {
    handle,
    items: rows.items,
    ready: detail !== undefined && !loading && scroller !== null && narrow !== null,
    extra: () => ({ sort, query }),
    apply: (saved) => {
      setSort(saved.sort);
      setQuery(saved.query);
    },
    matches: (saved) => sameSort(saved.sort, sort) && saved.query === query,
  });

  const paths = useMemo(() => rows.tracks.map(trackPathOf), [rows]);
  const firstOrderAt = (index: number) => {
    const item = rows.items[index];
    const next = item?.kind === 'group' ? rows.items[index + 1] : item;
    return next?.kind === 'row' ? next.order : undefined;
  };
  const play = (index: number) => {
    const order = firstOrderAt(index);
    if (album && order !== undefined && paths.length > 0)
      void trackActions.playPaths(paths, order, albumSource(album));
  };
  const openTrackMenu = (target: TableMenuTarget, point: TablePoint) => {
    const item = rows.items[target.index];
    const chosen =
      target.kind === 'rows'
        ? rowsOf(target.rows).flatMap((order) => rows.tracks[order] ?? [])
        : item?.kind === 'group'
          ? item.data.tracks
          : [];
    if (chosen.length === 0) return;
    void albumList.menu.prepare(
      chosen,
      item?.kind === 'row' ? rows.tracks[item.order] : undefined,
      stamp,
    );
    setTrackMenuAt(point);
  };
  const renderGroup = useCallback(
    (item: TableGroupItem<DiscGroup>) => {
      const title = detail?.facts?.discTitles.get(item.data.disc);
      const disc = item.data.disc;
      return (
        <div className={styles.disc} data-detail-disc={disc}>
          {title ? t('albumDetail.discTitled', { disc, title }) : t('albumDetail.disc', { disc })}
        </div>
      );
    },
    [detail?.facts, t],
  );

  return (
    <AlbumColorTheme album={album}>
      <DetailFrame
        label={album?.name || t('place.album')}
        page="album"
        glow={album !== null}
        intro={
          <>
            {album ? (
              <AlbumDetailHeader
                album={album}
                tracks={tracks}
                facts={detail?.facts ?? null}
                narrow={narrow === true}
                onMenu={setMenuAt}
              />
            ) : (
              <Spinner className={styles.spinner} label={t('albumDetail.opening')} />
            )}
            {detail?.phase === 'missing' && (
              <MessageBar className={styles.notice} intent="warning" data-detail-notice="missing">
                <MessageBarBody>{t('albumDetail.missing')}</MessageBarBody>
              </MessageBar>
            )}
            {detail?.failed && (
              <MessageBar className={styles.notice} intent="error" data-detail-notice="read">
                <MessageBarBody>{t('albumDetail.readFailed')}</MessageBarBody>
                <MessageBarActions>
                  <Button
                    className={viewControls.field}
                    size="small"
                    onClick={() => albumDetail.retry(key)}
                  >
                    {t('album.retry')}
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}
            {notice && (
              <MessageBar className={styles.notice} intent="warning" data-detail-notice="action">
                <MessageBarBody>{t(notice)}</MessageBarBody>
                <MessageBarActions>
                  <Button
                    className={viewControls.field}
                    size="small"
                    onClick={trackActions.dismissNotice}
                  >
                    {t('album.dismiss')}
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}
            {album && detail?.phase !== 'missing' && (
              <DetailTools
                query={query}
                onQuery={setQuery}
                fields={DETAIL_SORT_FIELDS}
                field={detailSortField(sort)}
                descending={sort?.descending ?? false}
                sorted={sort !== null}
                label={(column) =>
                  t(column === 'number' ? 'albumDetail.albumOrder' : columnDef(column).label)
                }
                onSort={(column, descending) => setSort(detailSort(column, descending))}
              />
            )}
          </>
        }
        overlay={
          <>
            <AlbumMenu at={menuAt} onClose={() => setMenuAt(null)} />
            <TrackMenu at={trackMenuAt} onClose={() => setTrackMenuAt(null)} />
          </>
        }
        onScroller={setScroller}
        onNarrow={setNarrow}
      >
        {album && detail?.phase !== 'missing' && (
          <TrackTable
            handle={handle}
            scrollParent={scroller}
            columns={columns}
            items={rows.items}
            selection={selection}
            label={t('albumDetail.table')}
            rowHeight={ROW_HEIGHT}
            renderGroup={renderGroup}
            ratingStamp={stamp}
            numberText={numberText}
            sort={sort}
            onSort={(column) => setSort((now) => nextDetailSort(now, column))}
            loading={loading}
            empty={
              !loading && !detail?.failed && query.trim() !== '' ? (
                <span data-detail-no-matches>{t('albumDetail.noMatches')}</span>
              ) : undefined
            }
            onPlay={play}
            onMenu={openTrackMenu}
          />
        )}
      </DetailFrame>
    </AlbumColorTheme>
  );
}
