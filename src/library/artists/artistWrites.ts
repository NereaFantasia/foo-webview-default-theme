import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { normalizeHostPath } from '../../host/hostPath.ts';
import { knownCommandsOf, readContextTree, runContextCommand } from '../../host/contextMenu.ts';
import { createTagWrites } from '../../track/tagWrites.ts';
import { trackPathOf } from '../../host/libraryContract.ts';
import type { ArtistBasis } from './artistPrefs.ts';

export interface ArtistTagChange {
  readonly track: LibraryTrack;
  readonly field: 'ARTIST' | 'ALBUM ARTIST';
  readonly before: string;
}
export interface ArtistWritePlan {
  readonly changes: readonly ArtistTagChange[];
  readonly skipped: readonly LibraryTrack[];
}

/** 只改所选口径的单值标签；专辑艺术家缺失时沿用曲目艺术家，不凭空新增另一字段。 */
export function artistWritePlan(
  tracks: readonly LibraryTrack[],
  names: readonly string[],
  basis: ArtistBasis,
): ArtistWritePlan {
  const selected = new Set(names.filter(Boolean));
  const changes: ArtistTagChange[] = [];
  const skipped: LibraryTrack[] = [];
  for (const track of tracks) {
    const album = basis === 'albumArtist' && track.albumArtists.length > 0;
    const values = album ? track.albumArtists : track.artists;
    if (!values.some((name) => selected.has(name))) continue;
    const before = values[0];
    if (values.length !== 1 || !before) skipped.push(track);
    else changes.push({ track, field: album ? 'ALBUM ARTIST' : 'ARTIST', before });
  }
  return { changes, skipped };
}

export function startArtistWrites(store: ReturnType<typeof createStore>, host = fb) {
  const state = atom({ busy: false, failed: false, completed: 0, total: 0 });
  const writes = createTagWrites(15_000);
  const off = host.on('metadata:writeComplete', writes.deliver);
  let disposed = false;
  const completed = new WeakMap<ArtistWritePlan, Map<ArtistTagChange, string>>();
  async function readValue(change: ArtistTagChange): Promise<string | null> {
    const read = await settle(() =>
      host.metadata.readRaw(trackPathOf(change.track), { cueIndex: change.track.subsong }),
    );
    if (disposed || !read || read.success === false) return null;
    const value = Object.entries(read.tags).find(
      ([key]) => key.toUpperCase() === change.field,
    )?.[1];
    if (typeof value === 'string') return value;
    return Array.isArray(value) && value.length === 1 && typeof value[0] === 'string'
      ? value[0]
      : null;
  }
  return {
    state: atom((get) => get(state)),
    async rename(plan: ArtistWritePlan, name: string): Promise<boolean> {
      if (disposed || store.get(state).busy || !name.trim() || !plan.changes.length) return false;
      store.set(state, { busy: true, failed: false, completed: 0, total: plan.changes.length });
      const target = name.trim();
      let saved = completed.get(plan);
      if (!saved) completed.set(plan, (saved = new Map()));
      let failed = false;
      for (const change of plan.changes) {
        if (disposed) return false;
        const current = await readValue(change);
        if (disposed) return false;
        if (current === target) {
          saved.set(change, target);
          store.set(state, { ...store.get(state), completed: store.get(state).completed + 1 });
          continue;
        }
        if (current !== (saved.get(change) ?? change.before)) {
          failed = true;
          continue;
        }
        const path = trackPathOf(change.track);
        const wait = writes.expect(normalizeHostPath(path), change.track.subsong, async () => {
          const value = await readValue(change);
          return value === null ? null : value === target;
        });
        const result = await settle(() =>
          host.metadata.write(path, { [change.field]: target }, { cueIndex: change.track.subsong }),
        );
        if (!result || result.success === false) {
          wait.cancel();
          failed = true;
        } else if ((await wait.done) !== true) failed = true;
        else saved.set(change, target);
        if (!disposed)
          store.set(state, {
            ...store.get(state),
            failed,
            completed: store.get(state).completed + 1,
          });
      }
      if (!disposed) store.set(state, { ...store.get(state), busy: false, failed });
      return !failed && !disposed;
    },
    async properties(tracks: readonly LibraryTrack[]): Promise<boolean> {
      if (disposed || !tracks.length) return false;
      const tree = await readContextTree(host, {
        mode: 'handles',
        handles: tracks.map(trackPathOf),
      });
      const command = knownCommandsOf(tree).properties;
      return !disposed && !!command && runContextCommand(host, tree, command);
    },
    dispose() {
      disposed = true;
      off();
      writes.dispose();
    },
  };
}
