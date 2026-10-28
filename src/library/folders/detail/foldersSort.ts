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
/** 目录序：同目录按碟号、曲号，再按显示标题；也是各列同值时的次序，升降序都不变 */
const DIRECTORY: Compare = (a, b) =>
  COLLATOR.compare(directory(a.absolutePath), directory(b.absolutePath)) ||
  a.discNumber - b.discNumber ||
  a.trackNumber - b.trackNumber ||
  COLLATOR.compare(trackDisplayTitle(a), trackDisplayTitle(b));

export function foldersSort<T extends LibraryTrack>(
  tracks: readonly T[],
  sort: TableSort | null,
): T[] {
  const by = sort ? TRACK_COMPARE[sort.column] : undefined;
  if (!sort || !by) return [...tracks].sort(DIRECTORY);
  const sign = sort.descending ? -1 : 1;
  return [...tracks].sort((a, b) => by(a, b) * sign || DIRECTORY(a, b));
}
