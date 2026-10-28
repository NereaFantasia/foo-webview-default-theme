import {
  Button,
  Input,
  Title2,
  Tooltip,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import {
  RecordRegular,
  ArrowShuffle20Regular,
  CheckmarkCircle16Regular,
  Play20Regular,
  Search16Regular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState, type ReactNode } from 'react';
import type { Translate } from '../../i18n/translate.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom, type PluralPick } from '../../i18n/plural.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { countRows } from '../../table/rangeSelection.ts';
import { FilterButton, type FilterSurfaceState } from '../../track/FilterSurface.tsx';
import { albumBrowseAtom, type AlbumBrowseState } from './albumBrowse.ts';
import styles from './AlbumPageHeader.module.css';
import { AlbumViewPanel, SortMenu } from './AlbumPageTools.tsx';
import { albumListOrdersAtom, albumListKey } from '../album-list/albumList.ts';
import { albumsAtom } from '../albums.ts';
import { albumSelectionAtom } from './albumSelection.ts';
import { browserPrefsAtom } from './browserPrefs.ts';
import { CommandBar, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { SelectionBar } from '../../track/SelectionBar.tsx';
import { pathHandlers, trackActionsKey } from '../../track/trackActions.ts';
import type { TrackMenuHandlers } from '../../track/trackMenuEntries.ts';
import { trackPathOf } from '../../host/libraryContract.ts';
import { LIBRARY_SOURCE } from '../../playback/playbackSource.ts';
import { rowsOf } from '../../table/rangeSelection.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { libraryTracksAtom } from '../libraryTracks.ts';
import { batchNameOf, TrackMenu } from '../TrackMenu.tsx';
import { facetSelectionCount } from './facets.ts';
import { ListSortMenu } from '../album-list/ListSortMenu.tsx';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { Metadata, MetadataItem } from '../../kit/Metadata.tsx';

const useStyles = makeStyles({
  title: { margin: 0, whiteSpace: 'nowrap' },
  filter: { width: '100%', minWidth: 0 },
});

export interface AlbumPageHeaderProps {
  readonly tier: CommandBarTier;
  readonly surface: FilterSurfaceState;
}

/** 副题里的计数：张数，列表形态再接首数；封面墙多选时接已选几张 */
interface SubtitleCounts {
  /** 列表形态里看得见的专辑一共几首；封面墙为 null */
  readonly tracks: number | null;
  /** 封面墙选中的专辑数；列表形态的选中数写在命令栏的选区操作里，这里为 0 */
  readonly selected: number;
}

/**
 * 副题：张数（列表形态接首数）；封面墙选中两张以上时接「已选 N 张」（单击只选一项是落焦点，不算多选）
 * 读取中写「正在读取…」，库太大被截断时如实说只显示了前多少张
 */
function subtitleOf(
  t: Translate,
  plural: PluralPick,
  browse: AlbumBrowseState,
  counts: SubtitleCounts,
  truncated: { readonly truncated: boolean; readonly count: number },
): ReactNode {
  if (browse.phase === 'loading') return t('album.loading');
  if (truncated.truncated) return t('album.truncated', { count: truncated.count });
  const { tracks, selected } = counts;
  return (
    <Metadata>
      <MetadataItem icon={<RecordRegular />}>
        {t(plural(browse.shown, 'album.countOne', 'album.count'), { count: browse.shown })}
      </MetadataItem>
      {tracks !== null && (
        <MetadataItem icon={<TextNumberListLtr16Regular />}>
          {t(plural(tracks, 'album.menuTracksOne', 'album.menuTracks'), { count: tracks })}
        </MetadataItem>
      )}
      {selected > 1 && (
        <MetadataItem icon={<CheckmarkCircle16Regular />}>
          {t('album.selectedCount', { count: selected })}
        </MetadataItem>
      )}
    </Metadata>
  );
}

/**
 * 专辑页页头。标题行左边是标题与副题，右边是播放全部与随机播放，按此刻显示的专辑次序；命令栏左边是专辑名搜索框与
 * 筛选，右边是排序与视图。列表形态的排序是列表形态自己那一份，视图面板按形态换内容
 */
export function AlbumPageHeader({ tier, surface }: AlbumPageHeaderProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const browse = useAtomValueRawSync(albumBrowseAtom);
  const prefs = useAtomValueRawSync(browserPrefsAtom);
  const list = useAtomValueRawSync(albumsAtom);
  const selectedAlbums = useAtomValueRawSync(albumSelectionAtom).size;
  const albums = useService(albumsKey);
  const albumList = useService(albumListKey);
  const { ranges } = useAtomValueRawSync(albumList.selection.state);
  const orders = useAtomValueRawSync(albumListOrdersAtom);
  const listForm = prefs.form === 'list';
  const narrow = tier === 'narrow';
  const labels = tier === 'wide';
  const counts: SubtitleCounts = listForm
    ? { tracks: orders.total, selected: 0 }
    : { tracks: null, selected: selectedAlbums };
  const classes = useStyles();
  const controls = useViewControlStyles();
  const filter = useRef<HTMLInputElement>(null);
  const { term } = browse;
  const playable = browse.phase !== 'loading' && browse.shown > 0;

  // Esc 在筛选框里清空筛选词；框是空的就不认领，交给更低的层
  useCommand({
    id: 'album.filter.clear',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => term !== '' && document.activeElement === filter.current,
    run: () => albums.browse.setTerm(''),
  });

  const truncated = { truncated: list.truncated, count: list.albums.length };
  // 列表形态选中两首以上时，命令栏左半换成作用于这批曲目的选区操作；封面墙选的是专辑，沿用专辑菜单
  const trackActions = useService(trackActionsKey);
  const loaded = useAtomValueRawSync(libraryTracksAtom);
  const [moreAt, setMoreAt] = useState<TablePoint | null>(null);
  const selectedTracks = listForm ? countRows(ranges) : 0;
  const picked = () => rowsOf(ranges).flatMap((order) => orders.trackAt(order) ?? []);
  const onSelected = (act: (handlers: TrackMenuHandlers) => void) => {
    const tracks = picked();
    if (tracks.length === 0) return;
    act(
      pathHandlers(trackActions, tracks.map(trackPathOf), batchNameOf(tracks, t), LIBRARY_SOURCE),
    );
  };
  const selection = selectedTracks > 1 && (
    <SelectionBar
      count={selectedTracks}
      labelled={labels}
      handlers={{
        play: () => onSelected((handlers) => handlers.play()),
        next: () => onSelected((handlers) => handlers.next()),
        enqueue: () => onSelected((handlers) => handlers.enqueue()),
        sendToNew: () => onSelected((handlers) => handlers.sendToNew()),
        sendTo: (target) => onSelected((handlers) => handlers.sendTo(target)),
      }}
      onClear={() => albumList.selection.clear()}
      onMore={(point) => {
        const tracks = picked();
        if (tracks.length === 0) return;
        void albumList.menu.prepare(tracks, undefined, loaded.stamp);
        setMoreAt(point);
      }}
    />
  );
  const box = (
    <Input
      ref={filter}
      className={mergeClasses(classes.filter, controls.field)}
      role="searchbox"
      contentBefore={<Search16Regular />}
      placeholder={t('album.filter')}
      aria-label={t('album.filter')}
      value={term}
      onChange={(_, data) => albums.browse.setTerm(data.value)}
      data-album-filter
    />
  );
  return (
    <header className={styles.root} data-tier={tier}>
      <div className={styles.titleRow}>
        <div className={styles.titles}>
          <Title2 as="h1" className={classes.title}>
            {t('album.title')}
          </Title2>
          {browse.phase !== 'disabled' && (
            <span className={styles.subtitle} data-album-subtitle>
              {subtitleOf(t, plural, browse, counts, truncated)}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <Tooltip content={t('album.playAll')} relationship="label">
            <Button
              appearance="primary"
              icon={<Play20Regular />}
              disabled={!playable}
              onClick={() => void albumList.playAll(prefs.form, false)}
              data-album-play-all
            >
              {narrow ? undefined : t('album.playAll')}
            </Button>
          </Tooltip>
          <Tooltip content={t('album.shuffleAll')} relationship="label">
            <Button
              appearance="subtle"
              className={controls.icon}
              icon={<ArrowShuffle20Regular />}
              disabled={!playable}
              onClick={() => void albumList.playAll(prefs.form, true)}
              data-album-shuffle-all
            >
              {narrow ? undefined : t('album.shuffleAll')}
            </Button>
          </Tooltip>
        </div>
      </div>
      <CommandBar
        tier={tier}
        label={t('album.tools')}
        search={{ box, active: term !== '' }}
        selection={selection || undefined}
        find={
          <FilterButton
            state={surface}
            count={facetSelectionCount(browse.facets)}
            labelled={labels}
          />
        }
        view={
          <>
            {listForm ? <ListSortMenu labelled={labels} /> : <SortMenu labelled={labels} />}
            <AlbumViewPanel labelled={labels} />
          </>
        }
      />
      <TrackMenu at={moreAt} onClose={() => setMoreAt(null)} />
    </header>
  );
}
