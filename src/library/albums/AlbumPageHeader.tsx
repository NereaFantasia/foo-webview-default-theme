import {
  Input,
  Title2,
  Toolbar,
  ToolbarRadioButton,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Filter16Regular, Grid20Regular, TextBulletListLtr20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef } from 'react';
import type { Translate } from '../../i18n/translate.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom, type PluralPick } from '../../i18n/plural.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { countRows } from '../../table/rangeSelection.ts';
import { albumBrowseAtom, type AlbumBrowseState } from './albumBrowse.ts';
import styles from './AlbumPageHeader.module.css';
import {
  DimensionMenu,
  DIMENSION_LABELS,
  PageMenu,
  SortMenu,
  TileSizeButton,
} from './AlbumPageTools.tsx';
import { albumListOrdersAtom, albumListKey } from '../album-list/albumList.ts';
import { ListDimensionMenu, ListExpandMenu } from '../album-list/AlbumListTools.tsx';
import { albumsAtom } from '../albums.ts';
import { albumSelectionAtom } from './albumSelection.ts';
import { ALBUM_FORMS, browserPrefsAtom, type BrowserPrefs } from './browserPrefs.ts';
import { facetSelectionCount } from './facets.ts';
import { ListSortMenu } from '../album-list/ListSortMenu.tsx';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';

const useStyles = makeStyles({
  title: { margin: 0, whiteSpace: 'nowrap' },
  forms: { padding: 0, gap: tokens.spacingHorizontalXXS },
  filter: { width: '200px', minWidth: '96px', flexShrink: 1 },
});

export interface AlbumPageHeaderProps {
  readonly facetsOpen: boolean;
  readonly onFacetsOpenChange: (open: boolean) => void;
}

/** 副题里的计数：张数，列表形态再接首数；多选时的「已选」按形态数张或数首。 */
interface SubtitleCounts {
  /** 列表形态里看得见的专辑一共几首；封面墙为 null。 */
  readonly tracks: number | null;
  readonly selected: number;
}

/**
 * 副题：张数（列表形态接首数），按某个依据分节时接「按流派分节」；选中两项以上时这一段换成「已选 N 张」或
 * 「已选 N 首」（单击只选一项是落焦点，不算多选）。读取中写「正在读取…」，库太大被截断时如实说只显示了前
 * 多少张。
 */
function subtitleOf(
  t: Translate,
  plural: PluralPick,
  browse: AlbumBrowseState,
  prefs: BrowserPrefs,
  counts: SubtitleCounts,
  truncated: { readonly truncated: boolean; readonly count: number },
): string {
  if (browse.phase === 'loading') return t('album.loading');
  if (truncated.truncated) return t('album.truncated', { count: truncated.count });
  const parts = [t(plural(browse.shown, 'album.countOne', 'album.count'), { count: browse.shown })];
  const { tracks, selected } = counts;
  if (tracks !== null) {
    parts.push(t(plural(tracks, 'album.menuTracksOne', 'album.menuTracks'), { count: tracks }));
  }
  if (selected > 1) {
    const key = tracks === null ? 'album.selectedCount' : 'albumList.selectedTracks';
    parts.push(t(key, { count: selected }));
  } else if (browse.headers) {
    parts.push(t('album.sectionedBy', { dimension: t(DIMENSION_LABELS[prefs.dimension]) }));
  }
  return parts.join(' · ');
}

/**
 * 专辑页页头：标题与副题，右边「封面墙 | 列表」、筛选框、分节、排序、封面大小与 ⋯；列表形态里封面大小换成
 * 展开 / 折叠键，分节与排序换成列表形态的那两份。
 * 写着当前值的分节、排序两个下拉键用缺省外观，带边框，与筛选框同一层次；只放图标的键用 subtle。
 * 宽度不够时右边整组折到标题下面一行，筛选框先收窄。
 */
export function AlbumPageHeader({ facetsOpen, onFacetsOpenChange }: AlbumPageHeaderProps) {
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
  const counts: SubtitleCounts = listForm
    ? { tracks: orders.total, selected: countRows(ranges) }
    : { tracks: null, selected: selectedAlbums };
  const classes = useStyles();
  const filter = useRef<HTMLInputElement>(null);
  const { term } = browse;

  // Esc 在筛选框里清空筛选词；框是空的就不认领，交给更低的层。
  useCommand({
    id: 'album.filter.clear',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => term !== '' && document.activeElement === filter.current,
    run: () => albums.browse.setTerm(''),
  });

  const truncated = { truncated: list.truncated, count: list.albums.length };
  return (
    <header className={styles.root}>
      <div className={styles.titles}>
        <Title2 as="h1" className={classes.title}>
          {t('album.title')}
        </Title2>
        {browse.phase !== 'disabled' && (
          <span className={styles.subtitle} data-album-subtitle>
            {subtitleOf(t, plural, browse, prefs, counts, truncated)}
          </span>
        )}
      </div>
      <div className={styles.tools} role="group" aria-label={t('album.tools')}>
        <Toolbar
          className={classes.forms}
          aria-label={t('album.form')}
          checkedValues={{ form: [prefs.form] }}
          onCheckedValueChange={(_, data) => {
            const next = ALBUM_FORMS.find((form) => data.checkedItems.includes(form));
            if (next) albums.prefs.setForm(next);
          }}
        >
          <Tooltip content={t('album.formWall')} relationship="label">
            <ToolbarRadioButton
              appearance="subtle"
              name="form"
              value="wall"
              icon={<Grid20Regular />}
              data-album-form="wall"
            />
          </Tooltip>
          <Tooltip content={t('album.formList')} relationship="label">
            <ToolbarRadioButton
              appearance="subtle"
              name="form"
              value="list"
              icon={<TextBulletListLtr20Regular />}
              data-album-form="list"
            />
          </Tooltip>
        </Toolbar>
        <Input
          ref={filter}
          className={classes.filter}
          contentBefore={<Filter16Regular />}
          placeholder={t('album.filter')}
          aria-label={t('album.filter')}
          value={term}
          onChange={(_, data) => albums.browse.setTerm(data.value)}
          data-album-filter
        />
        {listForm ? (
          <>
            <ListExpandMenu />
            <ListDimensionMenu />
            <ListSortMenu />
          </>
        ) : (
          <>
            <DimensionMenu />
            <SortMenu />
            <TileSizeButton />
          </>
        )}
        <PageMenu
          facetsOpen={facetsOpen}
          onFacetsOpenChange={onFacetsOpenChange}
          facetCount={facetSelectionCount(browse.facets)}
        />
      </div>
    </header>
  );
}
