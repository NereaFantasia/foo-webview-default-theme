import type { MenuCommand } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { runContextCommand, type ContextMenuFace, type ContextTree } from '../host/contextMenu.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { MessageKey } from '../i18n/en.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { exclusive, replaceAndPlay } from '../playback/libraryView.ts';
import type { PlaybackSource, PlaybackSourceService } from '../playback/playbackSource.ts';
import {
  queueLast,
  queueNext,
  sendToNewPlaylist,
  sendToPlaylist,
  type SendTarget,
  type TrackListFace,
} from './trackListActions.ts';
import type { TrackMenuHandlers } from './trackMenuEntries.ts';

const PLAY_FAILED: MessageKey = 'album.playFailed';
const COMMAND_FAILED: MessageKey = 'album.commandFailed';
const BUSY: MessageKey = 'album.busy';

const noticeAtom = atom<MessageKey | null>(null);

/** 起播与菜单命令的失败，或上一串还没跑完、这一次没执行的提示；界面挂成横幅。 */
export const trackActionsNoticeAtom: Atom<MessageKey | null> = atom((get) => get(noticeAtom));

export interface TrackActionsFace
  extends Pick<HostReadyFace, 'isAvailable'>, TrackListFace, ContextMenuFace {}

/**
 * 手上已有的一批曲目（`paths` 按显示顺序，由 `trackPathOf` 拼好）怎么起播、入队、发送与执行宿主命令。
 * 起播与入队动到专用列表，整页同一时刻只跑一串，正忙时不跑、挂忙碌提示，免得用户以为没点中。
 * 失败都挂横幅；没连上宿主时一律不发、答 false。
 *
 * 起播必须带上来源，宿主收下后在这里记下：专用列表里换成了什么只有起播的一方知道，漏记的话播放来源会
 * 停在上一次起播的地方。
 */
export interface TrackActionsService {
  /** 换进专用列表，从第 `index` 首起播。 */
  playPaths(paths: readonly string[], index: number, source: PlaybackSource): Promise<boolean>;
  /** 同上，路径在独占的那一串里现取：正忙时不取；取不到（null）算起播失败。 */
  playLoaded(
    load: () => Promise<readonly string[] | null>,
    index: number,
    source: PlaybackSource,
  ): Promise<boolean>;
  /** `next` 插到队首（下一首播放），否则接在队尾。 */
  queuePaths(paths: readonly string[], next: boolean): Promise<boolean>;
  /** 发到「发送到」子菜单里点的那一项；那张列表已经删了或锁着时宿主拒收，同样挂命令失败。 */
  sendPathsTo(paths: readonly string[], target: SendTarget): Promise<boolean>;
  sendPathsToNew(paths: readonly string[], name: string): Promise<boolean>;
  /** 对着 `tree` 生成时的那批曲目执行其中一条命令。 */
  runCommandIn(tree: ContextTree, node: MenuCommand): Promise<boolean>;
  /** 其余不动专用列表的宿主命令（建智能列表之类），失败同样挂命令失败。 */
  command(step: () => Promise<boolean>): Promise<boolean>;
  dismissNotice(): void;
  dispose(): void;
}

export function startTrackActions(
  store: Store,
  sources: Pick<PlaybackSourceService, 'record'>,
  host: TrackActionsFace = fb,
): TrackActionsService {
  store.set(noticeAtom, null);
  let disposed = false;
  const usable = () => !disposed && host.isAvailable();

  /** 成功清掉上一次的失败；被挡下时挂的忙碌提示留着，等下一次被收下再清。 */
  function finish(ok: boolean, failure: MessageKey): boolean {
    if (disposed) return ok;
    if (!ok) store.set(noticeAtom, failure);
    else if (store.get(noticeAtom) !== BUSY) store.set(noticeAtom, null);
    return ok;
  }

  async function onLibraryView(step: () => Promise<boolean>, failure: MessageKey) {
    if (!usable()) return false;
    const outcome = await exclusive(store, () => {
      if (store.get(noticeAtom) === BUSY) store.set(noticeAtom, null);
      return step();
    });
    if (outcome !== 'busy') return finish(outcome, failure);
    if (!disposed) store.set(noticeAtom, BUSY);
    return false;
  }

  async function command(step: () => Promise<boolean>): Promise<boolean> {
    return usable() ? finish(await step(), COMMAND_FAILED) : false;
  }

  async function play(step: () => Promise<boolean>, source: PlaybackSource): Promise<boolean> {
    const ok = await onLibraryView(step, PLAY_FAILED);
    if (ok && !disposed) sources.record(source);
    return ok;
  }

  return {
    playPaths: (paths, index, source) => play(() => replaceAndPlay(host, paths, index), source),
    playLoaded: (load, index, source) =>
      play(async () => {
        const paths = await load();
        return !!paths && replaceAndPlay(host, paths, index);
      }, source),
    queuePaths: (paths, next) =>
      onLibraryView(() => (next ? queueNext : queueLast)(host, paths), COMMAND_FAILED),
    sendPathsTo: (paths, target) => command(() => sendToPlaylist(host, paths, target)),
    sendPathsToNew: (paths, name) => command(() => sendToNewPlaylist(host, paths, name)),
    runCommandIn: (tree, node) => command(() => runContextCommand(host, tree, node)),
    command,
    dismissNotice() {
      if (!disposed) store.set(noticeAtom, null);
    },
    dispose() {
      disposed = true;
    },
  };
}

/**
 * 曲目菜单里的播放、入队与发送按这批路径执行；`name` 是发送到新列表时给新列表起的名字，`source` 是
 * 播放时记的来源。
 */
export function pathHandlers(
  actions: Pick<TrackActionsService, 'playPaths' | 'queuePaths' | 'sendPathsTo' | 'sendPathsToNew'>,
  paths: readonly string[],
  name: string,
  source: PlaybackSource,
): TrackMenuHandlers {
  return {
    play: () => void actions.playPaths(paths, 0, source),
    next: () => void actions.queuePaths(paths, true),
    enqueue: () => void actions.queuePaths(paths, false),
    sendToNew: () => void actions.sendPathsToNew(paths, name),
    sendTo: (target) => void actions.sendPathsTo(paths, target),
  };
}

export const trackActionsKey = serviceKey<TrackActionsService>('trackActions');
