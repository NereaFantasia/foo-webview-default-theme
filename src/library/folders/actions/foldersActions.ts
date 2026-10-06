import type { LibraryTrack, MenuCommand } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { runContextCommand, type ContextTree } from '../../../host/contextMenu.ts';
import type { Store } from '../../../kit/store.ts';
import { trackPathOf } from '../../../host/libraryContract.ts';
import { exclusive } from '../../../playback/libraryView.ts';
import { readFoldersTracks } from '../detail/foldersPreview.ts';
import { FOLDERS_LIMIT, foldersSubjects, type FolderNode } from '../tree/foldersModel.ts';
import { foldersWrite, type FoldersWrite } from './foldersWrites.ts';
import { createFoldersAutoplaylist, foldersQuery } from './foldersQuery.ts';

export type FoldersNotice =
  | 'busy'
  | 'failed'
  | 'limited'
  | 'queueLimit'
  | 'queryUnavailable'
  | 'tracksFailed'
  | 'autoplaylistFailed'
  | null;
const noticeAtom = atom<FoldersNotice>(null);
export const foldersNoticeAtom: Atom<FoldersNotice> = atom((get) => get(noticeAtom));
export interface FoldersTarget {
  readonly nodes: readonly FolderNode[];
  readonly tracks?: readonly LibraryTrack[];
  readonly nodeMenu?: boolean;
  readonly trackMenu?: boolean;
  readonly anchor?: LibraryTrack;
  readonly ratingStamp?: number;
}
export interface FoldersActionsDeps {
  record(subject: string, name: string): void;
  openPlaylist(guid: string): void;
  roots(): readonly FolderNode[];
}
export type FoldersActionsFace = Pick<
  typeof fb,
  'library' | 'playlist' | 'queue' | 'menu' | 'shell'
>;
export interface FoldersActionsService {
  collect(target: FoldersTarget): Promise<readonly LibraryTrack[] | null>;
  run(target: FoldersTarget, action: FoldersWrite, index?: number): Promise<void>;
  native(tree: ContextTree, command: MenuCommand): Promise<boolean>;
  explore(node: FolderNode): Promise<void>;
  autoplaylist(target: FoldersTarget): Promise<void>;
  dismiss(): void;
  cancel(): void;
  dispose(): void;
}
export function startFoldersActions(
  store: Store,
  deps: FoldersActionsDeps,
  host: FoldersActionsFace = fb,
): FoldersActionsService {
  store.set(noticeAtom, null);
  let disposed = false;
  let serial = 0;
  let busy = false;
  const notice = (value: FoldersNotice) => {
    if (!disposed) store.set(noticeAtom, value);
  };
  async function collect(target: FoldersTarget): Promise<readonly LibraryTrack[] | null> {
    const mine = serial;
    if (disposed) return null;
    if (target.tracks) return target.tracks;
    const tracks = new Map<string, LibraryTrack>();
    for (const node of target.nodes) {
      if (node.count > FOLDERS_LIMIT) {
        notice('limited');
        return null;
      }
      const batch = await readFoldersTracks(host, node);
      if (disposed || mine !== serial || !batch) return null;
      for (const track of batch) tracks.set(track.handle, track);
      if (tracks.size > FOLDERS_LIMIT) {
        notice('limited');
        return null;
      }
    }
    return [...tracks.values()];
  }
  return {
    collect,
    async run(target, action, index = 0) {
      if (disposed) return;
      if (busy) {
        notice('busy');
        return;
      }
      busy = true;
      notice(null);
      const mine = serial;
      const current = () => !disposed && mine === serial;
      try {
        const result = await exclusive(store, async () => {
          const tracks = await collect(target);
          if (!current() || !tracks?.length) return false;
          if ((action === 'next' || action === 'queue') && tracks.length > 256) {
            notice('queueLimit');
            return false;
          }
          const first = target.nodes[0];
          const ok = await foldersWrite(
            host,
            tracks.map(trackPathOf),
            action,
            first?.name ?? '',
            index,
            current,
          );
          if (ok && current() && action === 'play' && first)
            deps.record(
              foldersSubjects(target.nodes),
              target.nodes.map((node) => node.name).join(' · '),
            );
          return ok;
        });
        if (current() && result !== true && store.get(noticeAtom) === null)
          notice(result === 'busy' ? 'busy' : 'failed');
      } finally {
        busy = false;
      }
    },
    async native(tree, command) {
      if (disposed) return false;
      const ok = await runContextCommand(host, tree, command);
      if (!ok) notice('failed');
      return !disposed && ok;
    },
    async autoplaylist(target) {
      if (disposed) return;
      if (busy) {
        notice('busy');
        return;
      }
      busy = true;
      notice(null);
      const mine = serial;
      const current = () => !disposed && mine === serial;
      try {
        const query = foldersQuery(target.nodes, deps.roots());
        const tracks = query ? await collect({ nodes: target.nodes }) : null;
        if (!current()) return;
        if (!query) {
          notice('queryUnavailable');
          return;
        }
        if (!tracks) {
          if (store.get(noticeAtom) === null) notice('tracksFailed');
          return;
        }
        const guid = await createFoldersAutoplaylist(
          host,
          query,
          tracks,
          target.nodes[0]?.name ?? '',
          current,
        );
        if (current()) {
          if (guid) deps.openPlaylist(guid);
          else notice('autoplaylistFailed');
        }
      } finally {
        busy = false;
      }
    },
    async explore(node) {
      if (disposed) return;
      if ((await settle(() => host.shell.showInExplorer(node.absolutePath)))?.success !== true)
        notice('failed');
    },
    dismiss: () => notice(null),
    cancel() {
      serial += 1;
    },
    dispose() {
      disposed = true;
      serial += 1;
    },
  };
}
