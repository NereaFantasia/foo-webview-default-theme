import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { useService } from '../kit/useService.ts';
import type { TableTrack } from '../table/tableItems.ts';
import { albumListKey } from './album-list/albumList.ts';
import { libraryTracksAtom } from './libraryTracks.ts';
import { playStatsAtom, withStats } from './playStats.ts';

/** 并进播放统计的曲目；这一代统计还没取到时三项缺着，不当成 0 */
export type StatsTrack = LibraryTrack & Pick<TableTrack, 'added' | 'lastPlayed' | 'playCount'>;

export interface TrackStatsStatus {
  /** 要统计却没取成时的说明：探测组件失败，或整库曲目、统计读取失败 */
  readonly failed: MessageKey | null;
  retry(): void;
}

export interface TrackStatsView extends TrackStatsStatus {
  readonly tracks: readonly StatsTrack[];
}

/** 要统计时有没有取成、怎么重试；自己并统计的页面（歌曲页）只用这一半 */
export function useTrackStatsStatus(wanted: boolean): TrackStatsStatus {
  const albumList = useService(albumListKey);
  const library = useAtomValueRawSync(libraryTracksAtom);
  const stats = useAtomValueRawSync(playStatsAtom);
  return {
    failed: !wanted
      ? null
      : stats.probeFailed
        ? 'query.statsProbeFailed'
        : stats.readFailed || library.status === 'failed'
          ? stats.readFailed && stats.generation === library.generation && stats.byHandle?.size
            ? 'query.statsPartial'
            : 'query.statsReadFailed'
          : null,
    retry() {
      if (stats.probeFailed) void albumList.stats.probe();
      else if (library.status === 'ready')
        void albumList.stats.fetch([...library.byHandle.values()], library.generation);
      else void albumList.tracks.retry();
    },
  };
}

/**
 * 页面显示统计列或按统计排序时，把播放统计并进这一份曲目。统计缓存按整库代次共享，局部视图也按整库请求，
 * 避免一页的子集覆盖另一页。不需要、或这一代还没取到时原样返回
 */
export function useTrackStats(tracks: readonly LibraryTrack[], wanted: boolean): TrackStatsView {
  const albumList = useService(albumListKey);
  const library = useAtomValueRawSync(libraryTracksAtom);
  const stats = useAtomValueRawSync(playStatsAtom);
  useEffect(() => void albumList.stats.probe(), [albumList]);
  useEffect(() => (wanted ? albumList.tracks.want() : undefined), [albumList, wanted]);
  useEffect(() => {
    if (wanted && library.status === 'ready' && stats.available)
      void albumList.stats.fetch([...library.byHandle.values()], library.generation);
  }, [albumList, library, wanted, stats.available]);
  const current = wanted && stats.generation === library.generation ? stats.byHandle : null;
  const merged = useMemo(
    () =>
      current
        ? tracks.map((track): StatsTrack => withStats(track, current.get(track.handle)))
        : tracks,
    [tracks, current],
  );
  return { ...useTrackStatsStatus(wanted), tracks: merged };
}
