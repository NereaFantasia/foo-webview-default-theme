import type { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../host/hostCall.ts';
import type { RatedTrack } from '../track/ratingLedger.ts';
import type { SelectionRanges } from '../table/rangeSelection.ts';
import { playlistRowOf, ROW_FIELDS } from './playlistRow.ts';
import { HANDLE_PAGE } from './selectionHandles.ts';

export interface PlaylistMenuTracks {
  readonly tracks: readonly RatedTrack[];
  readonly stamps: readonly number[];
}

export async function readPlaylistMenuTracks(
  reader: Pick<typeof fb.playlist, 'getTracks'>,
  guid: string,
  ranges: SelectionRanges,
  stamp: () => number,
  current: () => boolean,
): Promise<PlaylistMenuTracks | null> {
  const tracks: RatedTrack[] = [];
  const stamps: number[] = [];
  for (const range of ranges) {
    for (let start = range.start; start < range.end; start += HANDLE_PAGE) {
      if (!current()) return null;
      const count = Math.min(HANDLE_PAGE, range.end - start);
      const taken = stamp();
      const answer = await settle(() =>
        reader.getTracks(guid, start, count, undefined, [...ROW_FIELDS]),
      );
      if (!current() || !answer || answer.success === false || answer.tracks.length !== count)
        return null;
      for (const track of answer.tracks) {
        tracks.push(playlistRowOf(track));
        stamps.push(taken);
      }
    }
  }
  return { tracks, stamps };
}
