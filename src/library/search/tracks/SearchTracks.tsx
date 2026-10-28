import { Body1, Button, Subtitle2 } from '@fluentui/react-components';
import { ArrowReset20Regular, Search32Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useCallback, type ReactNode } from 'react';
import { trackPathOf } from '../../../host/libraryContract.ts';
import type { MessageKey } from '../../../i18n/en.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { CommandBar, type CommandBarTier } from '../../../kit/CommandBar.tsx';
import { SegmentedTabs } from '../../../kit/SegmentedTabs.tsx';
import { useService } from '../../../kit/useService.ts';
import {
  DENSITY_ICONS,
  ViewPanel,
  ViewPanelActions,
  ViewPanelButton,
  ViewSection,
} from '../../../kit/ViewPanel.tsx';
import { LIBRARY_SOURCE } from '../../../playback/playbackSource.ts';
import { trackNumberText } from '../../../table/cellText.ts';
import { ColumnsPicker } from '../../../table/columns/ColumnsPicker.tsx';
import { countRows, rowsOf } from '../../../table/rangeSelection.ts';
import type { TableArtwork } from '../../../table/tableItems.ts';
import { TrackTable } from '../../../table/TrackTable.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { ConditionEditor } from '../../../track/ConditionEditor.tsx';
import { FilterConditions } from '../../../track/FilterConditions.tsx';
import {
  FilterButton,
  FilterSurface,
  type FilterSurfaceState,
} from '../../../track/FilterSurface.tsx';
import { filterConditions, noMatchText } from '../../../track/filterLabels.ts';
import { PresetChips } from '../../../track/PresetChips.tsx';
import { SelectionBar } from '../../../track/SelectionBar.tsx';
import { pathHandlers, trackActionsKey } from '../../../track/trackActions.ts';
import { TrackFacets } from '../../../track/TrackFacets.tsx';
import type { TrackMenuHandlers } from '../../../track/trackMenuEntries.ts';
import { TrackSortMenu } from '../../../track/TrackSortMenu.tsx';
import { playStatsAtom } from '../../playStats.ts';
import { SONGS_DENSITIES, type SongsDensity } from '../../songs/songsPrefs.ts';
import { SongArt } from '../../SongArt.tsx';
import { batchNameOf, TrackMenu } from '../../TrackMenu.tsx';
import { searchKey } from '../searchServices.ts';
import styles from './SearchTracks.module.css';
import type { SearchTracksModel } from './useSearchTracks.ts';

const DENSITY_LABELS: Readonly<Record<SongsDensity, MessageKey>> = {
  compact: 'songs.densityCompact',
  standard: 'songs.densityStandard',
  comfortable: 'songs.densityComfortable',
};

/**
 * 检索结果曲目分类命令栏
 * 包含字段菜单、筛选面板入口、排序与视图配置；选中多项时动态切换为批量选区操作栏，缺省排序为相关度
 */
export function SearchTracksBar({
  model,
  surface,
  tier,
  field,
}: {
  readonly model: SearchTracksModel;
  readonly surface: FilterSurfaceState;
  readonly tier: CommandBarTier;
  /** 字段▾，各分类共用，由结果页给 */
  readonly field: ReactNode;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const trackActions = useService(trackActionsKey);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const { ranges } = useAtomValueRawSync(model.selection.state);
  const labelled = tier === 'wide';
  // 点击操作时按当前快照获取曲目实例，避免高频渲染时反复展开全部选区范围
  const onSelected = (act: (handlers: TrackMenuHandlers) => void) => {
    const tracks = rowsOf(store.get(model.selection.state).ranges).flatMap(
      (row) => model.view.trackAt(row) ?? [],
    );
    if (tracks.length === 0) return;
    act(
      pathHandlers(trackActions, tracks.map(trackPathOf), batchNameOf(tracks, t), LIBRARY_SOURCE),
    );
  };
  const selected = countRows(ranges);
  return (
    <CommandBar
      tier={tier}
      label={t('query.toolbar')}
      selection={
        selected > 1 && (
          <SelectionBar
            count={selected}
            labelled={labelled}
            handlers={{
              play: () => onSelected((handlers) => handlers.play()),
              next: () => onSelected((handlers) => handlers.next()),
              enqueue: () => onSelected((handlers) => handlers.enqueue()),
              sendToNew: () => onSelected((handlers) => handlers.sendToNew()),
              sendTo: (target) => onSelected((handlers) => handlers.sendTo(target)),
            }}
            onClear={() => model.selection.clear()}
            onMore={(point) => {
              const rows = store.get(model.selection.state).ranges;
              const index = rowsOf(rows)[0];
              if (index !== undefined) model.menu.open({ kind: 'rows', rows, index }, point);
            }}
          />
        )
      }
      find={
        <>
          {field}
          <FilterButton
            state={surface}
            count={filterConditions(model.filter, t).length}
            labelled={labelled}
          />
        </>
      }
      view={
        <>
          <TrackSortMenu
            sort={model.sort}
            playcount={available}
            labelled={labelled}
            defaultLabel={t('search.relevance')}
            onSort={(next) => model.service.setSort(next)}
            buttonAttributes={{ 'data-search-sort': '' }}
          />
          <ViewPanel labelled={labelled} buttonAttributes={{ 'data-search-view': '' }}>
            <ViewSection label={t('songs.density')}>
              <SegmentedTabs
                label={t('songs.density')}
                value={model.density}
                options={SONGS_DENSITIES.map((density) => ({
                  value: density,
                  label: t(DENSITY_LABELS[density]),
                  icon: DENSITY_ICONS[density],
                }))}
                onChange={model.setDensity}
              />
            </ViewSection>
            <ViewPanelActions>
              <ColumnsPicker columns={model.columns} />
              <ViewPanelButton
                icon={<ArrowReset20Regular />}
                data-action="reset"
                onClick={() => {
                  model.columns.reset();
                  model.service.setSort(null);
                }}
              >
                {t('songs.resetView')}
              </ViewPanelButton>
            </ViewPanelActions>
          </ViewPanel>
        </>
      }
    />
  );
}

/**
 * 检索结果曲目筛选浮层与已选条件标签
 * 弹出式承载预设芯片、分面选项与自定义条件编辑，底部展示过滤后命中数统计与快捷清空操作
 */
export function SearchTracksFilter({
  model,
  surface,
}: {
  readonly model: SearchTracksModel;
  readonly surface: FilterSurfaceState;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const { available } = useAtomValueRawSync(playStatsAtom);
  const { filter, service } = model;
  const numbers = new Intl.NumberFormat();
  const count = filterConditions(filter, t).length;
  return (
    <>
      <FilterSurface
        id="search"
        state={surface}
        dockable={false}
        footer={
          <>
            <ConditionEditor playcount={available} onAdd={service.filter.addCondition} />
            <span className={styles.result}>
              {model.settled &&
                t('songs.filterResult', {
                  count: numbers.format(model.rows.handles.length),
                  total: numbers.format(model.matches.handles.length),
                })}
              <Button
                size="small"
                appearance="subtle"
                className={controls.icon}
                disabled={count === 0}
                onClick={service.filter.clearConditions}
              >
                {t('songs.conditionsClear')}
              </Button>
            </span>
          </>
        }
      >
        <PresetChips
          checked={filter.presets}
          playcount={available}
          onToggle={service.filter.togglePreset}
        />
        <TrackFacets
          filter={filter}
          options={model.facets}
          onToggle={service.filter.toggleFacet}
          tabs={surface.narrow}
        />
      </FilterSurface>
      <FilterConditions
        filter={filter}
        playcount={available}
        hideWhenEmpty
        onAdd={service.filter.addCondition}
        onClear={service.filter.clearConditions}
        onRemove={({ ref }) => {
          if (ref.kind === 'preset') service.filter.togglePreset(ref.id);
          else if (ref.kind === 'condition') service.filter.removeCondition(ref.key);
          else service.filter.toggleFacet(ref.facet, ref.name);
        }}
      />
    </>
  );
}

/**
 * 检索结果曲目虚拟表格
 * 挂接页面外层滚动容器并支持吸顶列头；支持激活播放、右键菜单与选区操作，并区分无命中与二次过滤无结果空态
 */
export function SearchTracksTable({
  model,
  scroller,
  label,
  empty,
}: {
  readonly model: SearchTracksModel;
  readonly scroller: HTMLElement | null;
  readonly label: string;
  readonly empty: ReactNode;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const search = useService(searchKey);
  const { view, filter, albumOf } = model;
  const artwork = useCallback<TableArtwork>(
    (track, size) => <SongArt album={albumOf(track)} size={size} />,
    [albumOf],
  );
  const filtered = filterConditions(filter, t).length > 0;
  return (
    <>
      <TrackTable
        columns={model.columns}
        items={model.items}
        selection={model.selection}
        label={label}
        rowHeight={model.rowHeight}
        ratingStamp={model.library.stamp}
        numberText={trackNumberText}
        sort={model.sort}
        onSort={model.onSort}
        artwork={artwork}
        loading={model.loading}
        scrollParent={scroller}
        empty={
          !model.settled ? undefined : filtered && model.matches.handles.length > 0 ? (
            <div className={styles.empty} data-search-empty="filtered">
              <Search32Regular className={styles.emptyIcon} aria-hidden />
              <Subtitle2>{t('search.filterNoMatch')}</Subtitle2>
              <Body1 className={styles.detail}>{noMatchText(filter, t)}</Body1>
              <Button
                appearance="primary"
                size="small"
                onClick={() => model.service.filter.clearConditions()}
              >
                {t('songs.clearAll')}
              </Button>
            </div>
          ) : (
            empty
          )
        }
        rank={(item, needle) =>
          item.kind === 'row' && item.track?.title.toLocaleLowerCase().startsWith(needle)
            ? 0
            : undefined
        }
        onPlay={(index) => {
          const track = view.trackAt(index);
          if (track) void search.play({ kind: 'track', track });
        }}
        onMenu={model.menu.open}
      />
      <TrackMenu at={model.menu.at} onClose={model.menu.close} isCurrent={model.menu.isCurrent} />
    </>
  );
}
