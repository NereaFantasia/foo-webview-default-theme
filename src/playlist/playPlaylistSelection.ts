import type { SelectionRanges } from '../table/rangeSelection.ts';
import { countRows } from '../table/rangeSelection.ts';
import { collectHandles, type HandleReader } from './selectionHandles.ts';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';

/** 分页前后核对来源版本；宿主未提供原子快照时，不能据此承诺跨调用事务。 */
export async function playPlaylistSelection(
  reader: HandleReader,
  guid: string,
  ranges: SelectionRanges,
  current: () => boolean,
  play: (paths: readonly string[]) => Promise<boolean>,
): Promise<boolean> {
  const count = countRows(ranges);
  if (!current() || count === 0 || count > SEND_TO_INLINE_LIMIT) return false;
  try {
    const tracks = await collectHandles(reader, guid, ranges);
    if (!current()) return false;
    return await play(
      tracks.map((track) =>
        track.subsong ? `${track.path}|subsong:${track.subsong}` : track.path,
      ),
    );
  } catch {
    return false;
  }
}
