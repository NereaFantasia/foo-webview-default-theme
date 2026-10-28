import { Button, Spinner } from '@fluentui/react-components';
import { ConditionEditor } from '../../../track/ConditionEditor.tsx';
import { FilterSurface, type FilterSurfaceState } from '../../../track/FilterSurface.tsx';
import { PresetChips } from '../../../track/PresetChips.tsx';
import { SegmentedTabs } from '../../../kit/SegmentedTabs.tsx';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { playStatsAtom } from '../../playStats.ts';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useState, type RefObject } from 'react';
import { albumArtwork } from '../../SongArt.tsx';
import { translateAtom } from '../../../i18n/locale.ts';
import { rowsOf } from '../../../table/rangeSelection.ts';
import { trackNumberText } from '../../../table/cellText.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { TrackTable, type TrackTableHandle } from '../../../table/TrackTable.tsx';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import type { FoldersTarget } from '../actions/foldersActions.ts';
import { FolderGroupHead } from './FolderGroupHead.tsx';
import { FolderCards } from './FolderCards.tsx';
import { FoldersConditions } from './FoldersConditions.tsx';
import { FoldersFacets } from './FoldersFacets.tsx';
import type { FoldersView } from './useFoldersView.ts';
import styles from './FoldersDetail.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { nextTrackSort } from '../../../track/trackSort.ts';

export interface FoldersDetailProps {
  readonly model: FoldersView;
  readonly handle: RefObject<TrackTableHandle | null>;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly sort: TableSort | null;
  readonly surface: FilterSurfaceState;
  readonly conditions: number;
  onSort(sort: TableSort | null): void;
  onMenu(target: FoldersTarget, point: TablePoint): void;
}
export function FoldersDetail(props: FoldersDetailProps) {
  const { model, handle, scroll, sort, surface, conditions, onSort, onMenu } = props;
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const { available } = useAtomValueRawSync(playStatsAtom);
  const folders = useService(foldersKey);
  const { preview, results, structure, items, columns, selection, prefs } = model;
  const numbers = new Intl.NumberFormat();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scroll.current = element;
      setScroller(element);
    },
    [scroll],
  );
  const tracks = structure.tracks;
  const target = { nodes: preview.nodes, tracks };
  const toggle = (index: number) => {
    const item = items[index];
    if (item?.kind === 'group') model.toggle(item.key);
  };
  return (
    <section className={styles.root} aria-label={t('folders.preview')}>
      <FilterSurface
        id="folders"
        state={surface}
        footer={
          <>
            <ConditionEditor playcount={available} onAdd={folders.results.addCondition} />
            <span className={styles.result}>
              {results.status === 'ready' &&
                t('folders.filterResult', {
                  count: numbers.format(results.tracks.length),
                  total: numbers.format(results.total),
                })}
              <Button
                size="small"
                appearance="subtle"
                className={controls.icon}
                disabled={conditions === 0}
                onClick={folders.results.clearConditions}
              >
                {t('songs.conditionsClear')}
              </Button>
            </span>
          </>
        }
      >
        <div className={styles.rangeRow}>
          <div className={styles.range}>
            <span className={styles.rangeTitle}>{t('folders.range')}</span>
            <SegmentedTabs
              label={t('folders.range')}
              value={prefs.recursive ? 'recursive' : 'direct'}
              options={[
                { value: 'recursive', label: t('folders.recursive') },
                { value: 'direct', label: t('folders.direct') },
              ]}
              onChange={(range) => folders.prefs.change({ recursive: range === 'recursive' })}
            />
          </div>
          <div className={styles.range}>
            <span className={styles.rangeTitle}>{t('folders.media')}</span>
            <SegmentedTabs
              label={t('folders.media')}
              value={model.media}
              options={[
                { value: 'all', label: t('folders.mediaAll') },
                { value: 'video', label: t('folders.mediaVideo') },
              ]}
              onChange={folders.results.setMedia}
            />
          </div>
        </div>
        <PresetChips
          checked={model.conditions.presets}
          playcount={available}
          onToggle={folders.results.togglePreset}
        />
        <FoldersFacets tracks={model.scopeTracks} filter={model.conditions} tabs={surface.narrow} />
      </FilterSurface>
      <FoldersConditions
        filter={model.conditions}
        hideWhenEmpty={!(surface.docked && surface.open)}
      />
      <div ref={attachScroller} className={styles.scroll}>
        {!preview.node && <div className={styles.empty}>{t('folders.pick')}</div>}
        {preview.status === 'loading' && <Spinner size="small" label={t('folders.loading')} />}
        {model.statsFailed && (
          <div role="alert" className={styles.notice}>
            {t(model.statsFailed)}
            <Button className={controls.field} onClick={model.retryStats}>
              {t('folders.retry')}
            </Button>
          </div>
        )}
        {preview.status === 'failed' && (
          <div role="alert" className={styles.notice}>
            {t('folders.previewFailed')}
            <Button className={controls.field} onClick={folders.preview.retry}>
              {t('folders.retry')}
            </Button>
          </div>
        )}
        {preview.status === 'limited' && (
          <>
            <p className={styles.notice}>{t('folders.limited')}</p>
            <FolderCards groups={[]} directories={preview.directories} size={128} onMenu={onMenu} />
          </>
        )}
        {preview.status === 'ready' && (
          <>
            {model.covers && <FolderCards groups={model.cards} size={prefs.size} onMenu={onMenu} />}
            {(!model.covers || items.length > 0) && (
              <TrackTable
                columns={columns}
                items={items}
                selection={selection}
                label={t('folders.tracks')}
                scrollParent={scroller}
                handle={handle}
                rowHeight={model.rowHeight}
                ratingStamp={preview.stamp}
                numberText={trackNumberText}
                artwork={albumArtwork}
                sort={sort}
                loading={results.status === 'loading'}
                groupFocus
                animateGroupFold={() => true}
                renderGroup={(item, state) => (
                  <FolderGroupHead
                    item={item}
                    state={state}
                    coverWidth={model.coverWidth}
                    full={model.full}
                    filtered={results.filtered}
                  />
                )}
                onToggleGroup={toggle}
                onSetGroup={(index, collapsed) => {
                  const item = items[index];
                  if (item?.kind === 'group' && item.collapsed !== collapsed)
                    model.toggle(item.key);
                }}
                onGroupClick={(_, __, toggle) => toggle()}
                onSort={(column) => {
                  if (column !== 'status' && column !== 'cover')
                    onSort(nextTrackSort(sort, column));
                }}
                empty={
                  model.covers
                    ? undefined
                    : t(
                        results.filtered
                          ? 'folders.noMatches'
                          : model.media === 'video'
                            ? 'folders.noVideos'
                            : 'folders.noTracks',
                      )
                }
                rank={(item, needle) =>
                  (item.kind === 'row'
                    ? item.track?.title
                    : item.kind === 'group'
                      ? item.data.group.node.name
                      : ''
                  )
                    ?.toLocaleLowerCase()
                    .startsWith(needle)
                    ? 0
                    : undefined
                }
                onPlay={(index) => {
                  if (!model.playable) return;
                  const item = items[index];
                  if (item?.kind === 'row') void folders.actions.run(target, 'play', item.order);
                  else if (item?.kind === 'group')
                    void folders.actions.run(
                      {
                        nodes: preview.nodes,
                        tracks: item.data.own ? item.data.group.direct : item.data.group.tracks,
                      },
                      'play',
                    );
                }}
                onMenu={(selectedTarget, point) => {
                  if (!model.playable) return;
                  if (selectedTarget.kind === 'group') {
                    const item = items[selectedTarget.index];
                    if (item?.kind === 'group')
                      onMenu(
                        {
                          nodes: preview.nodes,
                          tracks: item.data.own ? item.data.group.direct : item.data.group.tracks,
                          ratingStamp: preview.stamp,
                        },
                        point,
                      );
                  } else {
                    const picked = rowsOf(selectedTarget.rows).flatMap(
                      (index) => tracks[index] ?? [],
                    );
                    const item = items[selectedTarget.index];
                    if (picked.length)
                      onMenu(
                        {
                          nodes: preview.nodes,
                          tracks: picked,
                          trackMenu: true,
                          anchor: item?.kind === 'row' ? tracks[item.order] : undefined,
                          ratingStamp: preview.stamp,
                        },
                        point,
                      );
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
