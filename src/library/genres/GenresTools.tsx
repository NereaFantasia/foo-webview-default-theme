import { Button } from '@fluentui/react-components';
import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { COMMAND_BAR_TIERS, CommandBar, type CommandBarTier } from '../../kit/CommandBar.tsx';
import { useService } from '../../kit/useService.ts';
import { useWidthTier } from '../../kit/useWidthTier.ts';
import { ViewGrouping, ViewPanel } from '../../kit/ViewPanel.tsx';
import { ConditionEditor } from '../../track/ConditionEditor.tsx';
import { FilterConditions } from '../../track/FilterConditions.tsx';
import { FilterButton, FilterSurface, useFilterSurface } from '../../track/FilterSurface.tsx';
import { filterConditions } from '../../track/filterLabels.ts';
import { PresetChips } from '../../track/PresetChips.tsx';
import { QueryBox } from '../../track/QueryBox.tsx';
import { queryInputText } from '../../track/queryInput.ts';
import { TrackSortMenu } from '../../track/TrackSortMenu.tsx';
import { SelectionBar } from '../../track/SelectionBar.tsx';
import { pathHandlers, trackActionsKey } from '../../track/trackActions.ts';
import type { TrackMenuHandlers } from '../../track/trackMenuEntries.ts';
import { trackPathOf } from '../../host/libraryContract.ts';
import { LIBRARY_SOURCE } from '../../playback/playbackSource.ts';
import { countRows, rowsOf } from '../../table/rangeSelection.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { batchNameOf } from '../TrackMenu.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { playStatsAtom } from '../playStats.ts';
import { genresKey } from './genresServices.ts';
import { genresFilterAtom, genresToolsPrefsAtom } from './genresTools.ts';
import { GENRE_GROUPS, genresPrefsAtom } from './genresPrefs.ts';
import type { useGenresTable } from './useGenresTable.ts';
import styles from './GenresTools.module.css';

interface GenresToolsProps {
  readonly model: ReturnType<typeof useGenresTable>;
  readonly supported: boolean;
  readonly setClosed: (closed: ReadonlySet<string>) => void;
  /** 选区操作的 ⋯：在键下方打开这批曲目的曲目菜单 */
  readonly onSelectionMenu: (tracks: readonly LibraryTrack[], point: TablePoint) => void;
}

/** 浮层只有弹出一种形态：流派右栏没有嵌入面板的位置，固定与展开不落盘 */
const NO_DOCK = { docked: false, expanded: false, onDock() {}, onExpand() {} };

/**
 * 流派曲目表上方的命令栏：搜索框与筛选在左，排序与视图在右；条件行只在有条件时出。流派没有分面栏，
 * 筛选浮层里是常用条件与添加条件。名称查不了的流派不套条件与排序，只留视图
 */
export function GenresTools({ model, supported, setClosed, onSelectionMenu }: GenresToolsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const genres = useService(genresKey);
  const filter = useAtomValueRawSync(genresFilterAtom);
  const prefs = useAtomValueRawSync(genresToolsPrefsAtom);
  const groupPrefs = useAtomValueRawSync(genresPrefsAtom);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const controls = useViewControlStyles();
  const [queryOpen, setQueryOpen] = useState(false);
  const [measure, tier] = useWidthTier<CommandBarTier, HTMLDivElement>(COMMAND_BAR_TIERS);
  const surface = useFilterSurface({ ...NO_DOCK, narrow: tier === 'narrow' });
  const conditions = filterConditions(filter, t).length;
  const labelled = tier === 'wide';
  const trackActions = useService(trackActionsKey);
  const { ranges } = useAtomValueRawSync(model.selection.state);
  const selected = countRows(ranges);
  const picked = () => rowsOf(ranges).flatMap((index) => model.rows.tracks[index] ?? []);
  const onSelected = (act: (handlers: TrackMenuHandlers) => void) => {
    const tracks = picked();
    if (tracks.length === 0) return;
    act(
      pathHandlers(trackActions, tracks.map(trackPathOf), batchNameOf(tracks, t), LIBRARY_SOURCE),
    );
  };
  const selection = selected > 1 && (
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
      onMore={(point) => onSelectionMenu(picked(), point)}
    />
  );
  return (
    <div ref={measure} className={styles.root} data-genres-tools>
      <CommandBar
        tier={tier}
        label={t('query.toolbar')}
        selection={selection || undefined}
        search={
          supported
            ? {
                active: queryInputText(filter) !== '',
                box: (
                  <QueryBox
                    input={filter}
                    scope={prefs.scope}
                    invalid={model.rows.invalid}
                    menuOpen={queryOpen}
                    placeholder={t('songs.filterShort')}
                    label={t('genres.filterTracks')}
                    onChange={genres.tools.filter.setQuery}
                    onEnter={() => void genres.rows.retry()}
                    onScope={genres.tools.setScope}
                    onMenuOpenChange={setQueryOpen}
                  />
                ),
              }
            : undefined
        }
        find={supported && <FilterButton state={surface} count={conditions} labelled={labelled} />}
        view={
          <>
            {supported && (
              <TrackSortMenu
                sort={prefs.sort}
                playcount={available}
                onSort={genres.tools.setSort}
                labelled={labelled}
                defaultLabel={t('genres.defaultOrder')}
              />
            )}
            <ViewPanel labelled={labelled} buttonAttributes={{ 'data-genres-view': '' }}>
              <ViewGrouping
                label={t('genres.group')}
                value={model.group}
                options={GENRE_GROUPS.map((mode) => ({
                  value: mode,
                  label: t(`genres.group.${mode}`),
                }))}
                onChange={(group) => {
                  setClosed(new Set());
                  genres.prefs.update({ group });
                }}
                order={
                  model.group === 'none'
                    ? undefined
                    : {
                        descending: groupPrefs.groupDescending,
                        onChange: (groupDescending) => {
                          setClosed(new Set());
                          genres.prefs.update({ groupDescending });
                        },
                      }
                }
                fold={{
                  disabled: model.groups.length === 0,
                  expand: () => setClosed(new Set()),
                  collapse: () => setClosed(new Set(model.groups.map((entry) => entry.key))),
                }}
              />
            </ViewPanel>
          </>
        }
      />
      {supported && (
        <FilterSurface
          id="genres"
          state={surface}
          dockable={false}
          footer={
            <>
              <ConditionEditor playcount={available} onAdd={genres.tools.filter.addCondition} />
              <Button
                size="small"
                appearance="subtle"
                className={controls.icon}
                disabled={conditions === 0}
                onClick={genres.tools.filter.clearConditions}
              >
                {t('songs.conditionsClear')}
              </Button>
            </>
          }
        >
          <PresetChips
            checked={filter.presets}
            playcount={available}
            onToggle={genres.tools.filter.togglePreset}
          />
        </FilterSurface>
      )}
      {supported && (
        <FilterConditions
          filter={filter}
          playcount={available}
          hideWhenEmpty
          onAdd={genres.tools.filter.addCondition}
          onClear={genres.tools.filter.clearConditions}
          onRemove={({ ref }) => {
            if (ref.kind === 'preset') genres.tools.filter.togglePreset(ref.id);
            else if (ref.kind === 'condition') genres.tools.filter.removeCondition(ref.key);
            else genres.tools.filter.toggleFacet(ref.facet, ref.name);
          }}
        />
      )}
    </div>
  );
}
