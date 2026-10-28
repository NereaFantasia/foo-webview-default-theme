import { Body1, Button, Subtitle2 } from '@fluentui/react-components';
import { Search32Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../../i18n/en.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { FacetConditions } from '../../../kit/FacetConditions.tsx';
import { FacetPanel } from '../../../kit/FacetPanel.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import {
  FilterButton,
  FilterSurface,
  type FilterSurfaceState,
} from '../../../track/FilterSurface.tsx';
import { ToggleChipGroup } from '../../../track/PresetChips.tsx';
import { SearchFieldMenu } from '../SearchFieldMenu.tsx';
import { facetValueLabel, onlineFilterChips } from './onlineFilterChips.ts';
import {
  ONLINE_FACETS,
  ONLINE_PRESET_LABELS,
  ONLINE_PRESETS,
  ONLINE_SCOPES,
  type OnlineFacet,
} from './onlineTrackFilter.ts';
import type { OnlineFilter } from './useOnlineFilter.ts';
import styles from './OnlineFilter.module.css';

const FACET_LABELS: Readonly<Record<OnlineFacet, MessageKey>> = {
  artist: 'songs.facetArtist',
  album: 'table.album',
  quality: 'online.quality',
};

/** 搜索分类栏中的检索范围下拉菜单与筛选切换按钮，仅在单曲结果视图中呈现 */
export function OnlineFilterTools({
  filtering,
  surface,
  labelled,
}: {
  readonly filtering: OnlineFilter;
  readonly surface: FilterSurfaceState;
  readonly labelled: boolean;
}) {
  return (
    <>
      <SearchFieldMenu
        scope={filtering.scope}
        scopes={ONLINE_SCOPES}
        labelled={labelled}
        onScope={filtering.setScope}
      />
      <FilterButton state={surface} count={filtering.count} labelled={labelled} />
    </>
  );
}

/**
 * 在线搜索结果的筛选面板，集成常用预设与基于当前结果集聚合的多维分面。
 * 结果统计文案根据浮层弹出或页面内停靠形态，分别在底栏操作区或面板外部按需呈现
 */
export function OnlineFilterSurface({
  filtering,
  surface,
  loaded,
}: {
  readonly filtering: OnlineFilter;
  readonly surface: FilterSurfaceState;
  /** 当前已加载的曲目总数，不受检索范围与筛选条件影响 */
  readonly loaded: number;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const numbers = new Intl.NumberFormat();
  const result = t('online.filterResult', {
    count: numbers.format(filtering.shown.length),
    total: numbers.format(loaded),
  });
  return (
    <div className={styles.surface}>
      <FilterSurface
        id="online-search"
        state={surface}
        footer={
          <span className={styles.result}>
            {result}
            <Button
              size="small"
              appearance="subtle"
              className={controls.icon}
              disabled={filtering.count === 0}
              onClick={filtering.clear}
            >
              {t('songs.conditionsClear')}
            </Button>
          </span>
        }
      >
        <ToggleChipGroup
          title={t('query.presets')}
          chips={ONLINE_PRESETS.map((preset) => ({
            id: preset,
            label: t(ONLINE_PRESET_LABELS[preset]),
            checked: filtering.filter.presets.has(preset),
          }))}
          onToggle={(id) => {
            const preset = ONLINE_PRESETS.find((one) => one === id);
            if (preset) filtering.togglePreset(preset);
          }}
        />
        <FacetPanel
          label={t('songs.facets')}
          tabs={surface.narrow}
          columns={ONLINE_FACETS.map((facet) => ({
            id: facet,
            label: t(FACET_LABELS[facet]),
            selected: filtering.filter.facets[facet],
            options: filtering.facets[facet].map(({ value, count }) => ({
              value,
              label: facetValueLabel(facet, value, t),
              count,
            })),
          }))}
          onToggle={filtering.toggleFacet}
        />
      </FilterSurface>
      {surface.docked && filtering.active && (
        <div role="status" className={styles.dockedResult}>
          {result}
        </div>
      )}
    </div>
  );
}

/** 列表顶部的已选条件标签栏，未激活任何筛选条件时保持隐蔽 */
export function OnlineFilterConditions({ filtering }: { readonly filtering: OnlineFilter }) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <FacetConditions
      className={styles.conditions}
      label={t('album.facets')}
      chips={onlineFilterChips(filtering.filter, t)}
      removeLabel={(chip) => t('album.facetRemove', { value: chip.label })}
      clearLabel={t('album.facetClear')}
      onRemove={filtering.removeChip}
      onClear={filtering.clear}
    />
  );
}

/** 筛选无结果时的空状态面板，展示结果计数对比并提供一键重置操作 */
export function OnlineFilterEmpty({
  filtering,
  loaded,
}: {
  readonly filtering: OnlineFilter;
  readonly loaded: number;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const numbers = new Intl.NumberFormat();
  return (
    <div className={styles.empty} data-online-empty="filtered">
      <Search32Regular className={styles.emptyIcon} aria-hidden />
      <Subtitle2>{t('search.filterNoMatch')}</Subtitle2>
      <Body1 className={styles.detail}>
        {t('online.filterResult', { count: '0', total: numbers.format(loaded) })}
      </Body1>
      <Button
        appearance="primary"
        size="small"
        onClick={() => {
          filtering.clear();
          filtering.setScope('any');
        }}
      >
        {t('songs.clearAll')}
      </Button>
    </div>
  );
}
