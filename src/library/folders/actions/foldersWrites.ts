import { settle } from '../../../host/hostCall.ts';
import { enqueuePaths, playKeepingQueue } from '../../../host/queueCommands.ts';
import { ensureLibraryView } from '../../../playback/libraryView.ts';
import type { TrackListFace } from '../../../track/trackListActions.ts';

export type FoldersWrite = 'play' | 'next' | 'queue' | 'new' | { readonly guid: string };
export async function foldersWrite(
  host: TrackListFace,
  paths: readonly string[],
  action: FoldersWrite,
  name: string,
  index: number,
  current: () => boolean,
): Promise<boolean> {
  if (!current() || paths.length === 0) return false;
  if (action === 'next' || action === 'queue')
    return enqueuePaths(host, paths, action === 'next' ? 'next' : 'last', current);
  if (typeof action === 'object' || action === 'new') {
    const created = action === 'new' ? await settle(() => host.playlist.create(name)) : null;
    if (!current()) {
      if (created?.success === true && host.playlist.remove)
        await settle(() => host.playlist.remove!(created.guid));
      return false;
    }
    const guid =
      typeof action === 'object' ? action.guid : created?.success === true ? created.guid : null;
    if (!guid) return false;
    const added = await settle(() => host.library.addToPlaylist([...paths], guid));
    return current() && added?.success === true && added.added === paths.length;
  }
  const list = await ensureLibraryView(host, current);
  if (!list || !current()) return false;
  if (action === 'play') {
    if (index < 0 || index >= paths.length) return false;
    const cleared = await settle(() => host.playlist.clear(list.guid));
    if (!current() || cleared?.success !== true) return false;
  }
  const added = await settle(() => host.library.addToPlaylist([...paths], list.guid));
  if (!current() || added?.success !== true || added.added !== paths.length) return false;
  return playKeepingQueue(host, list.guid, index, undefined, current);
}
