import { Slider } from '@fluentui/react-components';
import {
  ChevronDownUp20Regular,
  ChevronUpDown20Regular,
  TextCollapse20Regular,
  TextExpand20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { SegmentedTabs } from '../../kit/SegmentedTabs.tsx';
import { SortMenu as SharedSortMenu } from '../../kit/SortMenu.tsx';
import { useService } from '../../kit/useService.ts';
import {
  FORM_ICONS,
  ViewDirection,
  ViewGrouping,
  ViewPanel,
  ViewPanelActions,
  ViewPanelButton,
  ViewSection,
} from '../../kit/ViewPanel.tsx';
import { GRID_STYLES, type GridStyle } from '../album-wall/albumGridLayout.ts';
import { albumListKey } from '../album-list/albumList.ts';
import { listPrefsAtom } from '../album-list/listPrefs.ts';
import { SECTION_ORDERS } from '../album-list/listSort.ts';
import { SECTION_DIMENSIONS, type SectionDimension } from '../albumSections.ts';
import { albumsKey } from '../albumServices.ts';
import { playStatsAtom } from '../playStats.ts';
import { albumSortOptions } from './albumSortOptions.ts';
import {
  ALBUM_FORMS,
  browserPrefsAtom,
  wallSortAtom,
  TILE_SIZE_MAX,
  TILE_SIZE_MIN,
  TILE_SIZE_STEP,
} from './browserPrefs.ts';

export const DIMENSION_LABELS: Readonly<Record<SectionDimension, MessageKey>> = {
  album: 'album.dimAlbum',
  albumArtist: 'album.dimAlbumArtist',
  artist: 'album.dimArtist',
  genre: 'album.dimGenre',
  folder: 'album.dimFolder',
  libraryRoot: 'album.dimLibraryRoot',
};

const STYLE_LABELS: Readonly<Record<GridStyle, MessageKey>> = {
  grid: 'album.styleGrid',
  compact: 'album.styleCompact',
  spaced: 'album.styleSpaced',
  gridNoText: 'album.styleGridNoText',
};

/** 封面墙的排序：字段、随机与方向，命令栏里文字固定 */
export function SortMenu({ labelled }: { readonly labelled: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const { sort } = useAtomValueRawSync(wallSortAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const albums = useService(albumsKey);
  return (
    <SharedSortMenu
      buttonAttributes={{ 'data-album-tool': 'sort' }}
      tool={{ labelled }}
      groups={albumSortOptions(t, available)}
      field={sort.field}
      descending={sort.descending}
      onField={albums.prefs.setWallField}
      onDescending={(descending) => albums.prefs.setWallSort({ ...sort, descending })}
      shuffle={{
        value: 'random',
        label: t('albumList.random'),
        run: () => albums.prefs.setWallField('random'),
      }}
    />
  );
}

/**
 * 专辑页的视图面板：版式与分节两种形态共用。封面墙另有封面大小与样式，大小与 Shift + 滚轮改的是同一个偏好，
 * 夹取与落盘归偏好服务；列表形态另有分节顺序与展开、折叠的几种批量操作
 */
export function AlbumViewPanel({ labelled }: { readonly labelled: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const { form, dimension, style, tileSize } = useAtomValueRawSync(browserPrefsAtom);
  const { sectionOrder, sectionDescending, albumGroups } = useAtomValueRawSync(listPrefsAtom);
  const albums = useService(albumsKey);
  const albumList = useService(albumListKey);
  const listForm = form === 'list';
  const sectioned = dimension !== 'album';
  return (
    <ViewPanel
      labelled={labelled}
      form={listForm ? 'list' : 'grid'}
      buttonAttributes={{ 'data-album-tool': 'view' }}
    >
      <ViewSection label={t('album.form')}>
        <SegmentedTabs
          label={t('album.form')}
          value={form}
          options={ALBUM_FORMS.map((value) => ({
            value,
            label: t(value === 'list' ? 'album.formList' : 'album.formWall'),
            icon: value === 'list' ? FORM_ICONS.list : FORM_ICONS.grid,
          }))}
          onChange={albums.prefs.setForm}
        />
      </ViewSection>
      <ViewGrouping
        label={t('album.dimension')}
        value={dimension}
        options={SECTION_DIMENSIONS.map((value) => ({
          value,
          label: t(DIMENSION_LABELS[value]),
        }))}
        onChange={albums.prefs.setDimension}
      />
      {listForm && sectioned && (
        <ViewSection label={t('albumList.sectionOrder')}>
          <SegmentedTabs
            label={t('albumList.sectionOrder')}
            value={sectionOrder}
            options={SECTION_ORDERS.map((value) => ({
              value,
              label: t(value === 'name' ? 'albumList.orderName' : 'albumList.orderCount'),
            }))}
            onChange={albumList.prefs.setSectionOrder}
          />
          <ViewDirection
            label={t('albumList.sectionDirection')}
            descending={sectionDescending ?? sectionOrder === 'count'}
            onChange={albumList.prefs.setSectionDescending}
          />
        </ViewSection>
      )}
      {listForm && (
        <ViewSection label={t('albumList.albumGroups')}>
          <SegmentedTabs
            label={t('albumList.albumGroups')}
            value={albumGroups ? 'album' : 'none'}
            options={[
              { value: 'album', label: t('albumList.byAlbum') },
              { value: 'none', label: t('albumList.ungrouped') },
            ]}
            onChange={(group) => albumList.prefs.setAlbumGroups(group === 'album')}
          />
        </ViewSection>
      )}
      {!listForm && (
        <>
          <ViewSection
            label={t('album.tileSize')}
            value={t('album.tileSizeValue', { size: tileSize })}
          >
            <Slider
              aria-label={t('album.tileSize')}
              min={TILE_SIZE_MIN}
              max={TILE_SIZE_MAX}
              step={TILE_SIZE_STEP}
              value={tileSize}
              onChange={(_, data) => albums.prefs.setTileSize(data.value)}
            />
          </ViewSection>
          <ViewSection label={t('album.style')}>
            <SegmentedTabs
              label={t('album.style')}
              value={style}
              options={GRID_STYLES.map((value) => ({ value, label: t(STYLE_LABELS[value]) }))}
              onChange={albums.prefs.setStyle}
            />
          </ViewSection>
        </>
      )}
      {listForm && (albumGroups || sectioned) && (
        <ViewPanelActions>
          <ViewPanelButton
            icon={<ChevronUpDown20Regular />}
            data-action="expand-all"
            onClick={() => albumList.batch('expandAll')}
          >
            {t('albumList.expandAll')}
          </ViewPanelButton>
          {sectioned && albumGroups && (
            <ViewPanelButton
              icon={<TextExpand20Regular />}
              data-action="only-sections"
              onClick={() => albumList.batch('onlySections')}
            >
              {t('albumList.onlySections', { dimension: t(DIMENSION_LABELS[dimension]) })}
            </ViewPanelButton>
          )}
          {albumGroups && (
            <ViewPanelButton
              icon={<TextCollapse20Regular />}
              data-action="collapse-albums"
              onClick={() => albumList.batch('collapseAlbums')}
            >
              {t('albumList.collapseAlbums')}
            </ViewPanelButton>
          )}
          {sectioned && (
            <ViewPanelButton
              icon={<ChevronDownUp20Regular />}
              data-action="collapse-all"
              onClick={() => albumList.batch('collapseAll')}
            >
              {t('albumList.collapseAll')}
            </ViewPanelButton>
          )}
        </ViewPanelActions>
      )}
    </ViewPanel>
  );
}
