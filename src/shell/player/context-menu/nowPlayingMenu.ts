import type { AlbumInfo, MenuCommand, Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { isHostPlaylist } from '../../../host/hostPlaylists.ts';
import { localeAtom } from '../../../i18n/locale.ts';
import {
  EMPTY_CONTEXT_TREE,
  readContextTree,
  runContextCommand,
  type ContextMenuFace,
  type ContextTree,
} from '../../../host/contextMenu.ts';
import type { Store } from '../../../kit/store.ts';
import { playbackAtom } from '../../../playback/playback.ts';
import { trackKeyOf } from '../../../playback/playbackContract.ts';
import { playingTrackKeyAtom } from '../../../playback/playingTrack.ts';
import { serviceKey } from '../../../kit/serviceKey.ts';

interface SendTarget {
  readonly guid: string;
  readonly name: string;
  readonly locked: boolean;
}

export interface NowPlayingMenuState {
  readonly track: Track | null;
  readonly stamp: number;
  readonly path: string;
  readonly album: AlbumInfo | null;
  readonly targets: readonly SendTarget[];
  readonly tree: ContextTree;
  readonly stopAfter: boolean | null;
}

export interface NowPlayingMenuFace extends ContextMenuFace {
  on: typeof fb.on;
  playlist: Pick<typeof fb.playlist, 'getAll'>;
  player: Pick<typeof fb.player, 'getStopAfterCurrent' | 'setStopAfterCurrent' | 'seek' | 'play'>;
}

export interface NowPlayingMenuDeps {
  readonly pathOf: (track: Track) => string;
  readonly albumOf: (track: Track) => AlbumInfo | null;
}

const EMPTY: NowPlayingMenuState = {
  track: null,
  stamp: 0,
  path: '',
  album: null,
  targets: [],
  tree: EMPTY_CONTEXT_TREE,
  stopAfter: null,
};
const stateAtom = atom<NowPlayingMenuState>(EMPTY);
const failureAtom = atom(false);
export const nowPlayingMenuAtom: Atom<NowPlayingMenuState> = atom((get) => get(stateAtom));
export const nowPlayingMenuFailureAtom: Atom<boolean> = atom((get) => get(failureAtom));

export interface NowPlayingMenuService {
  prepare(track: Track, stamp: number): Promise<void>;
  retry(): Promise<void>;
  isCurrent(track: Track): boolean;
  restart(): Promise<void>;
  setStopAfter(enabled: boolean): Promise<void>;
  run(node: MenuCommand): Promise<void>;
  report(action: Promise<boolean>): Promise<void>;
  dismissFailure(): void;
  close(): void;
  dispose(): void;
}

export function startNowPlayingMenu(
  store: Store,
  deps: NowPlayingMenuDeps,
  host: NowPlayingMenuFace = fb,
): NowPlayingMenuService {
  store.set(stateAtom, EMPTY);
  store.set(failureAtom, false);
  let disposed = false;
  let generation = 0;
  let treeRequest = 0;
  let stopRequest = 0;
  let commandRequest = 0;
  let playbackGeneration = 0;
  let offStop: (() => void) | undefined;
  const update = (patch: Partial<NowPlayingMenuState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  const current = (mine: number) => !disposed && mine === generation;
  const isCurrent = (track: Track) =>
    !disposed &&
    store.get(playbackAtom).status === 'connected' &&
    store.get(stateAtom).track === track &&
    store.get(playingTrackKeyAtom) === trackKeyOf(track);

  function close() {
    generation += 1;
    offStop?.();
    offStop = undefined;
    if (!disposed) store.set(stateAtom, EMPTY);
  }
  const offTrack = store.sub(playingTrackKeyAtom, () => {
    playbackGeneration += 1;
    close();
  });

  async function retry() {
    const { track, path } = store.get(stateAtom);
    if (!track || !isCurrent(track)) return;
    const mine = generation;
    const request = ++treeRequest;
    update({ tree: EMPTY_CONTEXT_TREE });
    const tree = await readContextTree(
      host,
      { mode: 'handles', handles: [path] },
      store.get(localeAtom).base,
    );
    if (current(mine) && request === treeRequest) update({ tree });
  }

  async function readStop() {
    const mine = generation;
    const request = ++stopRequest;
    const answer = await settle(() => host.player.getStopAfterCurrent());
    if (current(mine) && request === stopRequest)
      update({ stopAfter: answer?.success ? answer.enabled : null });
  }

  async function report(action: Promise<boolean>) {
    const request = ++commandRequest;
    store.set(failureAtom, false);
    const ok = await settle(() => action);
    // 关闭只作废读取，已经受理的动作仍须报告结果。
    if (!disposed && request === commandRequest) store.set(failureAtom, !ok);
  }

  return {
    isCurrent,
    retry,
    close,
    report,
    async prepare(track, stamp) {
      close();
      if (
        disposed ||
        store.get(playingTrackKeyAtom) !== trackKeyOf(track) ||
        store.get(playbackAtom).status !== 'connected'
      )
        return;
      const mine = generation;
      update({ track, stamp, path: deps.pathOf(track), album: deps.albumOf(track) });
      offStop = host.on('playback:stopAfterCurrentChanged', ({ enabled }) => {
        stopRequest += 1;
        if (current(mine)) update({ stopAfter: enabled });
      });
      const targets = settle(() => host.playlist.getAll()).then((answer) => {
        if (current(mine) && answer?.success)
          update({
            targets: answer.playlists
              .filter(({ name }) => !isHostPlaylist(name))
              .map(({ guid, name, isLocked }) => ({ guid, name, locked: isLocked })),
          });
      });
      await Promise.all([retry(), readStop(), targets]);
    },
    async setStopAfter(enabled) {
      const track = store.get(stateAtom).track;
      if (!track || !isCurrent(track)) return;
      await report(
        settle(() => host.player.setStopAfterCurrent(enabled)).then(
          (answer) => answer?.success === true,
        ),
      );
    },
    async restart() {
      const track = store.get(stateAtom).track;
      if (!track || !isCurrent(track) || !store.get(playbackAtom).canSeek) return;
      // seek 不改变来源列表；菜单关闭后仍可续完这条命令，但换曲后不能再恢复播放。
      const mine = playbackGeneration;
      await report(
        (async () => {
          const answer = await settle(() => host.player.seek(0));
          if (!answer?.success) return false;
          if (mine !== playbackGeneration || disposed || store.get(playbackAtom).state !== 'paused')
            return true;
          const played = await settle(() => host.player.play());
          return played?.success === true;
        })(),
      );
    },
    async run(node) {
      const { track, tree } = store.get(stateAtom);
      if (track && isCurrent(track)) await report(runContextCommand(host, tree, node));
    },
    dismissFailure() {
      commandRequest += 1;
      store.set(failureAtom, false);
    },
    dispose() {
      close();
      disposed = true;
      offTrack();
    },
  };
}

export const nowPlayingMenuKey = serviceKey<NowPlayingMenuService>('nowPlayingMenu');
