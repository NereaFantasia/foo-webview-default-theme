import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { hostCommand, settle } from '../../host/hostCall.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { anyIs, isQueryableValue } from '../../track/trackQuery.ts';
import type { AlbumsState } from '../albums.ts';
import { fetchAlbumTracks } from '../albumTracks.ts';
import { albumKeyOf, trackPathOf } from '../../host/libraryContract.ts';
import type { TrackActionsService } from '../../track/trackActions.ts';
import type { SendTarget } from '../../track/trackListActions.ts';
import type { ArtistRow } from './artistIndex.ts';
import { artistSections } from './artistDetail.ts';
import type { ArtistBasis } from './artistPrefs.ts';

export function artistQuery(
  names: readonly string[],
  basis: ArtistBasis,
  known: readonly string[],
): string | null {
  if (
    !names.length ||
    names.some(
      (name) =>
        !isQueryableValue(name) ||
        known.some((other) => other !== name && other.toLowerCase() === name.toLowerCase()),
    )
  )
    return null;
  const artist = anyIs('artist', names);
  return basis === 'credited'
    ? artist
    : `(${anyIs('"album artist"', names)} OR (NOT "album artist" PRESENT AND ${artist}))`;
}
export interface ArtistActionsDeps {
  readonly albums: Atom<AlbumsState>;
  readonly credited: Atom<readonly ArtistRow[] | null>;
  readonly actions: Pick<
    TrackActionsService,
    'playPaths' | 'queuePaths' | 'sendPathsTo' | 'sendPathsToNew'
  >;
  openSongs(query: string): void;
}

export function startArtistActions(
  store: ReturnType<typeof createStore>,
  deps: ArtistActionsDeps,
  host = fb,
) {
  const failed = atom(false);
  const busy = atom(false);
  let disposed = false;
  async function tracksOf(names: readonly string[]): Promise<readonly LibraryTrack[] | null> {
    const albums = store.get(deps.albums);
    const credited = store.get(deps.credited);
    if (disposed || !credited || albums.status !== 'ready' || !names.length) return null;
    const selected = new Set(names);
    const wanted = new Set(
      names.flatMap((name) => {
        const parts = artistSections(
          name,
          albums.albums,
          credited.find((row) => row.name === name),
        );
        return [...parts.own, ...parts.guest].map(albumKeyOf);
      }),
    );
    const items = albums.albums.filter((album) => wanted.has(albumKeyOf(album)));
    const groups: LibraryTrack[][] = Array.from({ length: items.length }, () => []);
    let next = 0;
    let failed = false;
    const current = () =>
      !disposed &&
      albums.albums === store.get(deps.albums).albums &&
      credited === store.get(deps.credited);
    async function worker() {
      while (next < items.length && current()) {
        const at = next++;
        const album = items[at];
        if (!album) continue;
        try {
          const tracks = await fetchAlbumTracks(host, album);
          groups[at] = tracks.filter(
            (track) =>
              selected.has(album.albumArtist) || track.artists.some((name) => selected.has(name)),
          );
        } catch {
          failed = true;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
    if (failed || !current()) return null;
    return [...new Map(groups.flat().map((track) => [trackPathOf(track), track])).values()];
  }
  async function run(action: () => Promise<boolean>): Promise<boolean> {
    if (disposed || store.get(busy)) return false;
    store.set(busy, true);
    store.set(failed, false);
    try {
      const ok = await action();
      if (!disposed) store.set(failed, !ok);
      return ok;
    } finally {
      if (!disposed) store.set(busy, false);
    }
  }
  async function withTracks(
    names: readonly string[],
    action: (paths: readonly string[]) => Promise<boolean>,
  ) {
    return run(async () => {
      const tracks = await tracksOf(names);
      return !!tracks?.length && !disposed && action(tracks.map(trackPathOf));
    });
  }
  return {
    failed: atom((get) => get(failed)),
    busy: atom((get) => get(busy)),
    tracksOf,
    play(names: readonly string[], shuffle = false, shown?: readonly LibraryTrack[], index = 0) {
      return run(async () => {
        const tracks = shown ?? (await tracksOf(names));
        if (!tracks?.length || disposed) return false;
        const paths = tracks.map(trackPathOf);
        if (shuffle)
          for (let at = paths.length - 1; at > 0; at -= 1) {
            const to = Math.floor(Math.random() * (at + 1));
            const a = paths[at];
            const b = paths[to];
            if (a && b) {
              paths[at] = b;
              paths[to] = a;
            }
          }
        // 几位一起播时记第一位；没写艺术家的主体是空串，名字用 `artists.unknown` 那一句。
        const subject = names[0] ?? '';
        return deps.actions.playPaths(paths, index, {
          kind: 'artist',
          subject,
          name: subject || store.get(translateAtom)('artists.unknown'),
        });
      });
    },
    queue(names: readonly string[], next: boolean) {
      return withTracks(names, (paths) =>
        paths.length <= 256 ? deps.actions.queuePaths(paths, next) : Promise.resolve(false),
      );
    },
    send(names: readonly string[], target?: SendTarget) {
      return withTracks(names, (paths) =>
        target
          ? deps.actions.sendPathsTo(paths, target)
          : deps.actions.sendPathsToNew(paths, names.join(', ')),
      );
    },
    autoplaylist(names: readonly string[], query: string) {
      return run(async () => {
        const result = await settle(() =>
          host.playlist.createAutoplaylist(names.join(', '), query),
        );
        return !!result && result.success !== false;
      });
    },
    openSongs: deps.openSongs,
    copy(names: readonly string[]) {
      return run(() => hostCommand(() => host.clipboard.write(names.join('\n'))));
    },
    dispose() {
      disposed = true;
    },
  };
}
export type ArtistActions = ReturnType<typeof startArtistActions>;
