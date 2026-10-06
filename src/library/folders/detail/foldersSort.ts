import type { LibraryTrack } from 'foo-webview-sdk';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { trackDisplayTitle } from '../../../track/trackDisplayTitle.ts';

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function directory(path: string): string {
  return path.replace(/[/\\][^/\\]*$/, '');
}
export function foldersSort(
  tracks: readonly LibraryTrack[],
  sort: TableSort | null,
): LibraryTrack[] {
  const compare = (a: LibraryTrack, b: LibraryTrack) => {
    switch (sort?.column) {
      case 'title':
        return COLLATOR.compare(trackDisplayTitle(a), trackDisplayTitle(b));
      case 'artist':
        return COLLATOR.compare(a.artist, b.artist);
      case 'album':
        return COLLATOR.compare(a.album, b.album);
      case 'duration':
        return a.duration - b.duration;
      case 'rating':
        return a.rating - b.rating;
      case 'number':
        return a.discNumber - b.discNumber || a.trackNumber - b.trackNumber;
      default:
        return (
          COLLATOR.compare(directory(a.absolutePath), directory(b.absolutePath)) ||
          a.discNumber - b.discNumber ||
          a.trackNumber - b.trackNumber ||
          COLLATOR.compare(trackDisplayTitle(a), trackDisplayTitle(b))
        );
    }
  };
  return [...tracks].sort((a, b) => compare(a, b) * (sort?.descending ? -1 : 1));
}
