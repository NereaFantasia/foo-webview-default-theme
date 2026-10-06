import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useCallback, useMemo, useState, type RefObject } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { rowsOf } from '../../../table/rangeSelection.ts';
import { trackNumberText } from '../../../table/cellText.ts';
import type { TableLinks, TablePoint } from '../../../table/tableItems.ts';
import { TrackTable, type TrackTableHandle } from '../../../table/TrackTable.tsx';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { albumsAtom } from '../../albums.ts';
import { albumKeyOf, trackAlbumKeyOf } from '../../../host/libraryContract.ts';
import type { FoldersTarget } from '../actions/foldersActions.ts';
import { FolderGroupHead } from './FolderGroupHead.tsx';
import { FolderCards } from './FolderCards.tsx';
import { FoldersConditions } from './FoldersConditions.tsx';
import { FoldersFacets } from './FoldersFacets.tsx';
import type { FoldersView } from './useFoldersView.ts';
import styles from './FoldersDetail.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { albumDetailKey } from '../../album-detail/albumDetail.ts';

export interface FoldersDetailProps {
  readonly model: FoldersView;
  readonly handle: RefObject<TrackTableHandle | null>;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly sort: TableSort | null;
  onSort(sort: TableSort | null): void;
  onMenu(target: FoldersTarget, point: TablePoint): void;
}
export function FoldersDetail({ model, handle, scroll, sort, onSort, onMenu }: FoldersDetailProps) {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const albumDetail = useService(albumDetailKey);
  const { albums } = useAtomValueRawSync(albumsAtom);
  const { preview, results, structure, items, columns, selection, prefs } = model;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attachScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scroll.current = element;
      setScroller(element);
    },
    [scroll],
  );
  const tracks = structure.tracks;
  const links = useMemo<TableLinks>(
    () => ({
      album(track) {
        const full = tracks.find((entry) => entry.handle === track.handle);
        const key = full ? trackAlbumKeyOf(full) : null;
        const album = key ? albums.find((entry) => albumKeyOf(entry) === key) : undefined;
        if (album) albumDetail.open(album);
      },
    }),
    [tracks, albums, albumDetail],
  );
  const target = { nodes: preview.nodes, tracks };
  const toggle = (index: number) => {
    const item = items[index];
    if (item?.kind === 'group') model.toggle(item.key);
  };
  return (
    <section className={styles.root} aria-label={t('folders.preview')}>
      <FoldersConditions filter={model.conditions} />
      {prefs.facetsOpen && <FoldersFacets tracks={model.scopeTracks} filter={model.conditions} />}
      <div ref={attachScroller} className={styles.scroll}>
        {!preview.node && <div className={styles.empty}>{t('folders.pick')}</div>}
        {preview.status === 'loading' && <Spinner size="small" label={t('folders.loading')} />}
        {preview.status === 'failed' && (
          <div role="alert" className={styles.notice}>
            {t('folders.previewFailed')}
            <Button onClick={folders.preview.retry}>{t('folders.retry')}</Button>
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
                links={links}
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
                    onSort({
                      column,
                      descending: sort?.column === column ? !sort.descending : false,
                    });
                }}
                empty={
                  model.covers
                    ? undefined
                    : t(results.filtered ? 'folders.noMatches' : 'folders.noTracks')
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
