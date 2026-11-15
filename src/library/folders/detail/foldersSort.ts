import type { LibraryTrack } from 'foo-webview-sdk';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { trackDisplayTitle } from '../../../track/trackDisplayTitle.ts';
import type { StatsTrack } from '../../useTrackStats.ts';
import { TRACK_COMPARE } from '../../../track/trackSort.ts';

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
type Compare = (a: StatsTrack, b: StatsTrack) => number;
function directory(path: string): string {
  return path.replace(/[/\\][^/\\]*$/, '');
}
/**
 * 曲号可信才像一张专辑：每张碟的曲号恰好是 1 到 n。自己攒的歌单里曲号来自各自的专辑，
 * 凑不成这个数列；只看传入的这批曲目，筛选后留下的子集可能因此改用文件名序
 */
function albumLike(tracks: readonly LibraryTrack[]): boolean {
  const discs = new Map<number, number[]>();
  for (const { discNumber, trackNumber } of tracks) {
    const numbers = discs.get(discNumber);
    if (numbers) numbers.push(trackNumber);
    else discs.set(discNumber, [trackNumber]);
  }
  return [...discs.values()].every((numbers) =>
    numbers.sort((a, b) => a - b).every((number, index) => number === index + 1),
  );
}
/**
 * 目录序：先按目录；同目录里像专辑的按碟号、曲号，再按显示标题，否则按文件名，贴近资源管理器；
 * 也是各列同值时的次序，升降序都不变
 */
function directoryOrder(tracks: readonly LibraryTrack[]): Compare {
  const byDirectory = new Map<string, LibraryTrack[]>();
  for (const track of tracks) {
    const key = directory(track.absolutePath).toLowerCase();
    const group = byDirectory.get(key);
    if (group) group.push(track);
    else byDirectory.set(key, [track]);
  }
  const albums = new Set(
    [...byDirectory].filter(([, group]) => albumLike(group)).map(([key]) => key),
  );
  return (a, b) => {
    const at = directory(a.absolutePath);
    return (
      COLLATOR.compare(at, directory(b.absolutePath)) ||
      (albums.has(at.toLowerCase())
        ? a.discNumber - b.discNumber ||
          a.trackNumber - b.trackNumber ||
          COLLATOR.compare(trackDisplayTitle(a), trackDisplayTitle(b))
        : COLLATOR.compare(a.absolutePath, b.absolutePath) || a.subsong - b.subsong)
    );
  };
}

export function foldersSort<T extends LibraryTrack>(
  tracks: readonly T[],
  sort: TableSort | null,
): T[] {
  const inDirectory = directoryOrder(tracks);
  const by = sort ? TRACK_COMPARE[sort.column] : undefined;
  if (!sort || !by) return [...tracks].sort(inDirectory);
  const sign = sort.descending ? -1 : 1;
  return [...tracks].sort((a, b) => by(a, b) * sign || inDirectory(a, b));
}
