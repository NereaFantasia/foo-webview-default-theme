import {
  Button,
  CounterBadge,
  Label,
  MenuButton,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  PopoverSurface,
  PopoverTrigger,
  Slider,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Menu, Popover } from '../../motion/Surfaces.tsx';
import { MoreHorizontal20Regular, ResizeImage20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { GRID_STYLES, type GridStyle } from '../album-wall/albumGridLayout.ts';
import styles from './AlbumPageTools.module.css';
import {
  ALBUM_SORTS,
  SECTION_DIMENSIONS,
  type AlbumSort,
  type SectionDimension,
} from '../albumSections.ts';
import { browserPrefsAtom, TILE_SIZE_MAX, TILE_SIZE_MIN, TILE_SIZE_STEP } from './browserPrefs.ts';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';

export const DIMENSION_LABELS: Readonly<Record<SectionDimension, MessageKey>> = {
  album: 'album.dimAlbum',
  albumArtist: 'album.dimAlbumArtist',
  artist: 'album.dimArtist',
  genre: 'album.dimGenre',
  folder: 'album.dimFolder',
  libraryRoot: 'album.dimLibraryRoot',
};

const SORT_LABELS: Readonly<Record<AlbumSort, MessageKey>> = {
  name: 'album.sortName',
  artist: 'album.sortArtist',
  year: 'album.sortYear',
  trackCount: 'album.sortTrackCount',
};

/** 键上写短名：长名里的「新在前」「多在前」只在菜单里说明方向。 */
const SORT_SHORT: Readonly<Record<AlbumSort, MessageKey>> = {
  ...SORT_LABELS,
  year: 'album.sortYearShort',
  trackCount: 'album.sortTrackCountShort',
};

const STYLE_LABELS: Readonly<Record<GridStyle, MessageKey>> = {
  grid: 'album.styleGrid',
  compact: 'album.styleCompact',
  spaced: 'album.styleSpaced',
  gridNoText: 'album.styleGridNoText',
};

const useStyles = makeStyles({
  more: { position: 'relative' },
  badge: { position: 'absolute', top: 0, right: 0, pointerEvents: 'none' },
  size: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    minWidth: '220px',
  },
});

/** 菜单里勾中的值只认这一组里有的：Fluent 答的是字符串，别处写进来的不认。 */
function pick<T extends string>(values: readonly T[], checked: readonly string[]): T | undefined {
  return values.find((value) => checked.includes(value));
}

/** 分节依据：单选菜单，键上写当前那一档。 */
export function DimensionMenu() {
  const t = useAtomValueRawSync(translateAtom);
  const { dimension } = useAtomValueRawSync(browserPrefsAtom);
  const albums = useService(albumsKey);
  return (
    <Menu
      checkedValues={{ dimension: [dimension] }}
      onCheckedValueChange={(_, data) => {
        const next = pick(SECTION_DIMENSIONS, data.checkedItems);
        if (next) albums.prefs.setDimension(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton data-album-tool="dimension">
          {t('album.dimensionValue', { value: t(DIMENSION_LABELS[dimension]) })}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('album.dimension')}>
          {SECTION_DIMENSIONS.map((value) => (
            <MenuItemRadio key={value} name="dimension" value={value}>
              {t(DIMENSION_LABELS[value])}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function SortMenu() {
  const t = useAtomValueRawSync(translateAtom);
  const { sort } = useAtomValueRawSync(browserPrefsAtom);
  const albums = useService(albumsKey);
  return (
    <Menu
      checkedValues={{ sort: [sort] }}
      onCheckedValueChange={(_, data) => {
        const next = pick(ALBUM_SORTS, data.checkedItems);
        if (next) albums.prefs.setSort(next);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton data-album-tool="sort">
          {t('album.sortValue', { value: t(SORT_SHORT[sort]) })}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('album.sort')}>
          {ALBUM_SORTS.map((value) => (
            <MenuItemRadio key={value} name="sort" value={value}>
              {t(SORT_LABELS[value])}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** 封面大小：一个图标键，点开一条滑块。与 Shift + 滚轮改的是同一个偏好，夹取与落盘归偏好服务。 */
export function TileSizeButton() {
  const t = useAtomValueRawSync(translateAtom);
  const { tileSize } = useAtomValueRawSync(browserPrefsAtom);
  const albums = useService(albumsKey);
  const classes = useStyles();
  const sliderId = useId();
  return (
    <Popover positioning="below-end" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={t('album.tileSize')} relationship="label">
          <Button appearance="subtle" icon={<ResizeImage20Regular />} data-album-tool="tile-size" />
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className={classes.size}>
        <div className={styles['size-head']}>
          <Label htmlFor={sliderId}>{t('album.tileSize')}</Label>
          <span>{t('album.tileSizeValue', { size: tileSize })}</span>
        </div>
        <Slider
          id={sliderId}
          min={TILE_SIZE_MIN}
          max={TILE_SIZE_MAX}
          step={TILE_SIZE_STEP}
          value={tileSize}
          onChange={(_, data) => albums.prefs.setTileSize(data.value)}
        />
      </PopoverSurface>
    </Popover>
  );
}

export interface PageMenuProps {
  readonly facetsOpen: boolean;
  readonly onFacetsOpenChange: (open: boolean) => void;
  /** 勾着的筛选值有几个。筛选条收起时角上写这个数：那是筛选还在生效的唯一痕迹。 */
  readonly facetCount: number;
}

/** 页头最右的 ⋯：显示样式（四档单选，只管封面墙，列表形态里不出）与筛选条的开关。 */
export function PageMenu({ facetsOpen, onFacetsOpenChange, facetCount }: PageMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { style, form } = useAtomValueRawSync(browserPrefsAtom);
  const albums = useService(albumsKey);
  const classes = useStyles();
  return (
    <Menu
      checkedValues={{ facets: facetsOpen ? ['open'] : [] }}
      onCheckedValueChange={(_, data) => {
        if (data.name === 'facets') onFacetsOpenChange(data.checkedItems.includes('open'));
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t('album.pageMenu')} relationship="label">
          <Button
            className={classes.more}
            appearance="subtle"
            icon={<MoreHorizontal20Regular />}
            data-album-tool="page-menu"
          >
            {!facetsOpen && facetCount > 0 && (
              <CounterBadge className={classes.badge} size="small" count={facetCount} />
            )}
          </Button>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {form === 'wall' && (
            <Menu
              checkedValues={{ style: [style] }}
              onCheckedValueChange={(_, data) => {
                const next = pick(GRID_STYLES, data.checkedItems);
                if (next) albums.prefs.setStyle(next);
              }}
            >
              <MenuTrigger disableButtonEnhancement>
                <MenuItem>{t('album.style')}</MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {GRID_STYLES.map((value) => (
                    <MenuItemRadio key={value} name="style" value={value}>
                      {t(STYLE_LABELS[value])}
                    </MenuItemRadio>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
          <MenuItemCheckbox name="facets" value="open" data-album-tool="facets">
            {t('album.showFacets')}
          </MenuItemCheckbox>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
