import {
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuTrigger,
  Tab,
  type MenuCheckedValueChangeData,
  type MenuCheckedValueChangeEvent,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { FacetConditions } from '../../kit/FacetConditions.tsx';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { TabList } from '../../motion/Surfaces.tsx';
import type { MusicAlbumSubType } from '../../server/musicObjects.ts';
import { FilterToggle } from '../../track/FilterSurface.tsx';
import { DetailTools } from '../detail/DetailTools.tsx';
import {
  isDefaultReleaseSort,
  KIND_ORDER,
  RELEASE_SORT_FIELDS,
  VERSION_ORDER,
  type ReleaseKind,
  type ReleaseSortField,
} from './artistReleases.ts';
import type { ArtistReleases, ArtistTab } from './useArtistReleases.ts';
import styles from './ArtistTools.module.css';

const TAB_LABELS = {
  songs: 'artistAlbums.tab.songs',
  albums: 'artistAlbums.tab.albums',
  singles: 'artistAlbums.tab.singles',
} as const satisfies Record<ArtistTab, MessageKey>;
const SORT_LABELS = {
  date: 'artistAlbums.sort.date',
  name: 'artistAlbums.sort.name',
  tracks: 'artistAlbums.sort.tracks',
} as const satisfies Record<ReleaseSortField, MessageKey>;
const KIND_LABELS = {
  single: 'onlineList.kind.single',
  ep: 'onlineList.kind.ep',
} as const satisfies Record<ReleaseKind, MessageKey>;
const VERSION_LABELS = {
  studio: 'artistAlbums.version.studio',
  live: 'artistAlbums.version.live',
  remix: 'artistAlbums.version.remix',
  instrumental: 'artistAlbums.version.instrumental',
  demo: 'artistAlbums.version.demo',
} as const satisfies Record<MusicAlbumSubType, MessageKey>;

type FacetId = 'kind' | 'version';

interface FacetColumn {
  readonly id: FacetId;
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
}

/** 工具行靠左的页签：热门歌曲、专辑、单曲与 EP */
export function ArtistTabs({ releases }: { readonly releases: ArtistReleases }) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <TabList
      size="small"
      aria-label={t('artistAlbums.tabs')}
      selectedValue={releases.tab}
      onTabSelect={(_, data) => {
        const next = releases.tabs.find((value) => value === data.value);
        if (next) releases.setTab(next);
      }}
    >
      {releases.tabs.map((value) => (
        <Tab key={value} value={value}>
          {t(TAB_LABELS[value])}
        </Tab>
      ))}
    </TabList>
  );
}

/**
 * 艺人发行列表工具栏：集成关键词搜索、多维筛选与排序（仅作用于当前页签）
 *
 * 筛选菜单按类型与版本分组呈现，并标明候选数量；可用选项不足两项的分组自动隐藏，全部不足时隐藏筛选按钮；
 * 激活筛选条件时按键呈现角标并在条件行展示已选药丸
 */
export function ArtistReleaseTools({
  releases,
  tabs = true,
}: {
  readonly releases: ArtistReleases;
  /** 工具行靠左是否放页签；专辑墙页只有一节，不放 */
  readonly tabs?: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const [open, setOpen] = useState(false);
  const { view, facets } = releases;
  const chips = [
    ...KIND_ORDER.filter((value) => view.kinds.has(value)).map((value) => ({
      key: `kind:${value}`,
      label: t(KIND_LABELS[value]),
    })),
    ...VERSION_ORDER.filter((value) => view.versions.has(value)).map((value) => ({
      key: `version:${value}`,
      label: t(VERSION_LABELS[value]),
    })),
  ];
  const columns: FacetColumn[] = [
    ...(facets.kinds.shown
      ? [
          {
            id: 'kind' as const,
            label: t('artistAlbums.kinds'),
            options: facets.kinds.options.map(({ value, count }) => ({
              value,
              label: t(KIND_LABELS[value]),
              count,
            })),
          },
        ]
      : []),
    ...(facets.versions.shown
      ? [
          {
            id: 'version' as const,
            label: t('artistAlbums.versions'),
            options: facets.versions.options.map(({ value, count }) => ({
              value,
              label: t(VERSION_LABELS[value]),
              count,
            })),
          },
        ]
      : []),
  ];
  const onChecked = (_: MenuCheckedValueChangeEvent, data: MenuCheckedValueChangeData) => {
    if (data.name === 'kind')
      for (const value of KIND_ORDER)
        if (data.checkedItems.includes(value) !== view.kinds.has(value)) releases.toggleKind(value);
    if (data.name === 'version')
      for (const value of VERSION_ORDER)
        if (data.checkedItems.includes(value) !== view.versions.has(value))
          releases.toggleVersion(value);
  };
  return (
    <>
      <DetailTools
        query={view.query}
        onQuery={releases.setQuery}
        fields={RELEASE_SORT_FIELDS}
        field={view.sort.field}
        descending={view.sort.descending}
        sorted={!isDefaultReleaseSort(view.sort)}
        label={(field) => t(SORT_LABELS[field])}
        onSort={releases.setSort}
        findLabel={t('artistAlbums.find')}
        sortLabel={t('artistAlbums.sort')}
        start={tabs ? <ArtistTabs releases={releases} /> : undefined}
        filter={
          columns.length > 0 ? (
            <Menu
              open={open}
              onOpenChange={(_, data) => setOpen(data.open)}
              checkedValues={{ kind: [...view.kinds], version: [...view.versions] }}
              onCheckedValueChange={onChecked}
            >
              <MenuTrigger disableButtonEnhancement>
                <FilterToggle open={open} count={chips.length} labelled={false} />
              </MenuTrigger>
              <MenuPopover>
                <MenuList aria-label={t('album.facets')}>
                  {columns.map((column, index) => (
                    <MenuGroup key={column.id}>
                      {index > 0 && <MenuDivider />}
                      <MenuGroupHeader>{column.label}</MenuGroupHeader>
                      {column.options.map((option) => (
                        <MenuItemCheckbox
                          key={option.value}
                          name={column.id}
                          value={option.value}
                          persistOnClick
                          secondaryContent={option.count}
                          data-facet-option={`${column.id}:${option.value}`}
                        >
                          {option.label}
                        </MenuItemCheckbox>
                      ))}
                    </MenuGroup>
                  ))}
                  <MenuDivider />
                  <MenuItem disabled={chips.length === 0} onClick={releases.clearFacets}>
                    {t('album.facetClear')}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : undefined
        }
        below={
          <FacetConditions
            className={styles.conditions}
            label={t('album.facets')}
            chips={chips}
            removeLabel={(chip) => t('album.facetRemove', { value: chip.label })}
            clearLabel={t('album.facetClear')}
            onRemove={(key) => {
              const [facet, value] = key.split(':');
              const kind = KIND_ORDER.find((item) => item === value);
              const version = VERSION_ORDER.find((item) => item === value);
              if (facet === 'kind' && kind) releases.toggleKind(kind);
              else if (facet === 'version' && version) releases.toggleVersion(version);
            }}
            onAdd={() => setOpen(true)}
            onClear={releases.clearFacets}
          />
        }
      />
    </>
  );
}
