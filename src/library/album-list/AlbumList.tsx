import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { discTrackText } from '../../table/cellText.ts';
import type { ColumnId } from '../../table/columns/columns.ts';
import { createColumnsModel } from '../../table/columns/columnsModel.ts';
import { rowsOf } from '../../table/rangeSelection.ts';
import type { TableGroupItem, TableItem, TablePoint, TableTrack } from '../../table/tableItems.ts';
import {
  TrackTable,
  type TableGroupState,
  type TrackTableHandle,
} from '../../table/TrackTable.tsx';
import { useTableSnapshot, type TableView } from '../../table/useTableSnapshot.ts';
import type { TableMenuTarget } from '../../table/useTrackTableInput.ts';
import { albumBrowseAtom } from '../albums/albumBrowse.ts';
import { albumCoversVersionAtom } from '../albumCovers.ts';
import { albumDetailPendingAtom } from '../album-detail/albumDetailOpen.ts';
import { albumListOrdersAtom, albumListKey } from './albumList.ts';
import styles from './AlbumList.module.css';
import { AlbumListGroup, type ListGroupHandlers } from './AlbumListGroup.tsx';
import {
  buildListItems,
  type AlbumListGroup as GroupData,
  type ListSection,
} from './albumListModel.ts';
import { BrowseEmptyState } from '../albums/BrowseEmptyState.tsx';
import { browserPrefsAtom } from '../albums/browserPrefs.ts';
import { albumKeyOf, trackPathOf } from '../../host/libraryContract.ts';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { albumListCollapseAtom } from './listFolding.ts';
import { listPrefsAtom } from './listPrefs.ts';
import { ListSectionMenu } from './ListSectionMenu.tsx';
import { playStatsAtom } from '../playStats.ts';
import { TrackMenu } from '../TrackMenu.tsx';
import { useService } from '../../kit/useService.ts';
import { trackActionsKey } from '../../track/trackActions.ts';
import { albumSource } from '../albumActions.ts';
import { albumsKey } from '../albumServices.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

/** 曲目行高；节头与专辑分组头各自的高。CSS 像素。 */
const ROW_HEIGHT = 40;
const SECTION_HEIGHT = 40;
const ALBUM_HEIGHT = 36;
/** 列存档的键：列表形态一张表一份。 */
const COLUMNS_KEY = 'default-theme.album-list-columns.v1';
/** 列表形态有的列：专辑列不要，分组头已经写了专辑。 */
const OFFERED: readonly ColumnId[] = [
  'cover',
  'status',
  'number',
  'title',
  'artist',
  'rating',
  'duration',
];

type Item = TableItem<GroupData>;

/** 离开这条历史记录时记下的滚动与焦点行。 */
const LIST_SLOT = createSnapshotSlot<TableView<null>>();

export interface AlbumListProps {
  /** 右键封面或专辑分组头：专辑菜单只作用于这一张，作用对象已交给专辑菜单服务。 */
  readonly onAlbumMenu: (point: TablePoint) => void;
}

/**
 * 专辑页的列表形态：流派节、专辑分组头、封面列与曲目行，用表格内核。节与专辑两层都能开合、落盘；列头不能
 * 点着排序，排序在页头。单击封面或专辑名进详情页；单击分组头的空白选中整张，双击播放整张。右键曲目行出曲目
 * 菜单，作用于选中的行；右键封面或专辑分组头出专辑菜单，只作用于那一张；右键节头出节的菜单。
 */
export function AlbumList({ onAlbumMenu }: AlbumListProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const store = useStore();
  const albums = useService(albumsKey);
  const trackActions = useService(trackActionsKey);
  const albumList = useService(albumListKey);
  const albumDetail = useService(albumDetailKey);
  const opening = useAtomValueRawSync(albumDetailPendingAtom);
  const orders = useAtomValueRawSync(albumListOrdersAtom);
  const collapse = useAtomValueRawSync(albumListCollapseAtom);
  const loaded = useAtomValueRawSync(libraryTracksAtom);
  const { sort } = useAtomValueRawSync(listPrefsAtom);
  const { dimension } = useAtomValueRawSync(browserPrefsAtom);
  const sectionGroups = dimension !== 'album';
  const { available } = useAtomValueRawSync(playStatsAtom);
  const { phase } = useAtomValueRawSync(albumBrowseAtom);
  useAtomValueRawSync(albumCoversVersionAtom);
  const [columns] = useState(() =>
    createColumnsModel(store, {
      key: COLUMNS_KEY,
      offered: OFFERED,
      hidden: ['status'],
      widths: { cover: 160 },
    }),
  );
  const { coverWidth } = useAtomValueRawSync(columns.layout);
  const { containerWidth } = useAtomValueRawSync(columns.state);
  const [trackMenuAt, setTrackMenuAt] = useState<TablePoint | null>(null);
  const [sectionMenu, setSectionMenu] = useState<{ section: ListSection; at: TablePoint } | null>(
    null,
  );
  const handle = useRef<TrackTableHandle>(null);

  const fillers = coverWidth > 0 ? Math.ceil(coverWidth / ROW_HEIGHT) : 0;
  const items = useMemo(
    () => buildListItems(orders, collapse, fillers),
    [orders, collapse, fillers],
  );

  // 从详情页后退回来：滚动与焦点行交还。宽度量到了才算排定：封面列的宽定了垫位的行数，早落的话滚动按一份
  // 还会变高的条目流算。
  useTableSnapshot(LIST_SLOT, {
    handle,
    items,
    ready: loaded.status === 'ready' && containerWidth > 0,
    extra: () => null,
  });

  useEffect(() => albumList.tracks.want(), [albumList]);
  useEffect(() => albumList.syncOrders(orders), [albumList, orders]);
  useEffect(() => albumList.syncStats(), [albumList, loaded, sort.field, available]);

  // 序号格写「碟.曲」，碟号只在这张专辑不止一张碟时写：按曲目找它所在专辑的碟数。
  const numberText = useMemo(() => {
    const discs = new Map<string, number>();
    for (const section of orders.sections) {
      for (const entry of section.albums) {
        for (const track of entry.tracks ?? []) discs.set(track.handle, entry.album.discCount);
      }
    }
    return (track: TableTrack) => discTrackText(track, discs.get(track.handle) ?? 1);
  }, [orders]);

  const groupHeight = useCallback(
    (item: TableGroupItem<GroupData>) =>
      item.data.kind === 'section' ? SECTION_HEIGHT : ALBUM_HEIGHT,
    [],
  );
  const groupAt = (index: number) => {
    const item: Item | undefined = items[index];
    return item?.kind === 'group' ? item.data : undefined;
  };
  const [handlers] = useState<ListGroupHandlers>(() => ({
    open: (album) => albumDetail.open(album),
    toggleAlbum(entry, siblings, state) {
      if (siblings) albumList.toggleAlbum(entry, true);
      else state.toggle();
    },
  }));

  /** 双击或回车：曲目行从这一首起播整张，专辑分组头从头播整张；曲目还没到手时照封面墙的办法现取。 */
  const play = (index: number) => {
    const item = items[index];
    const entry =
      item?.kind === 'row'
        ? orders.albumAt(item.order)
        : item?.kind === 'group' && item.data.kind === 'album'
          ? item.data.entry
          : undefined;
    if (!item || !entry) return;
    const at = item.kind === 'row' ? item.order - entry.span.start : 0;
    if (!entry.tracks) void albums.actions.play(entry.album, at);
    else void trackActions.playPaths(entry.tracks.map(trackPathOf), at, albumSource(entry.album));
  };

  const menu = (target: TableMenuTarget, point: TablePoint) => {
    if (target.kind === 'rows') {
      const tracks = rowsOf(target.rows).flatMap((order) => orders.trackAt(order) ?? []);
      const item = items[target.index];
      void albumList.menu.prepare(
        tracks,
        item?.kind === 'row' ? orders.trackAt(item.order) : undefined,
        loaded.stamp,
      );
      setTrackMenuAt(point);
      return;
    }
    const group = groupAt(target.index);
    if (group?.kind === 'section') setSectionMenu({ section: group.section, at: point });
    else if (group) {
      void albums.menu.prepare([group.entry.album]);
      onAlbumMenu(point);
    }
  };

  const renderGroup = (item: TableGroupItem<GroupData>, state: TableGroupState) => (
    <AlbumListGroup
      item={item}
      state={state}
      coverWidth={coverWidth}
      covers={albums.covers}
      handlers={handlers}
      opening={
        opening !== null &&
        item.data.kind === 'album' &&
        albumKeyOf(item.data.entry.album) === opening.key
      }
      t={t}
      plural={plural}
      animateSection={sectionGroups}
    />
  );

  const empty =
    phase === 'disabled' || phase === 'empty' || phase === 'noMatch' ? (
      <BrowseEmptyState phase={phase} />
    ) : undefined;

  return (
    <div className={styles.root} data-album-list>
      <TrackTable
        handle={handle}
        columns={columns}
        items={items}
        selection={albumList.selection}
        label={t('albumList.table')}
        rowHeight={ROW_HEIGHT}
        groupHeight={groupHeight}
        renderGroup={renderGroup}
        groupFocus
        animateGroupFold={(item) => item.data.kind === 'album' || sectionGroups}
        ratingStamp={loaded.stamp}
        numberText={numberText}
        loading={phase === 'loading' || loaded.status === 'loading'}
        empty={empty}
        onPlay={play}
        onMenu={menu}
        onGroupClick={(index, modifiers, toggle) => {
          const group = groupAt(index);
          if (group?.kind === 'section') {
            if (modifiers.alt || modifiers.ctrl)
              albumList.toggleSection(group.section.key, modifiers);
            else toggle();
          } else if (group) {
            const { start, end } = group.entry.span;
            albumList.selection.selectSpan(start, end, modifiers);
          }
        }}
        onToggleGroup={(index) => {
          const group = groupAt(index);
          if (group?.kind === 'section') {
            albumList.toggleSection(group.section.key, { alt: false, ctrl: false });
          } else if (group) albumList.toggleAlbum(group.entry, false);
        }}
        onSetGroup={(index, collapsed) => {
          const group = groupAt(index);
          if (group) albumList.setGroup(group, collapsed);
        }}
        onExpandSiblings={(index) => {
          const group = groupAt(index);
          if (group) albumList.expandSiblings(group);
        }}
        rank={(item, needle) =>
          item.kind === 'group' &&
          item.data.kind === 'album' &&
          item.data.entry.album.name.toLocaleLowerCase().startsWith(needle)
            ? 0
            : undefined
        }
      />
      <TrackMenu at={trackMenuAt} onClose={() => setTrackMenuAt(null)} />
      <ListSectionMenu target={sectionMenu} onClose={() => setSectionMenu(null)} />
    </div>
  );
}
