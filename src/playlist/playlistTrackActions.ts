import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { enqueuePaths, QUEUE_BATCH, type EnqueuePlace } from '../host/queueCommands.ts';
import type { Store } from '../kit/store.ts';
import { countRows, type SelectionRanges } from '../table/rangeSelection.ts';
import { MAIN_COMMANDS } from './playlistActions.ts';
import type { PlaylistSelectionService } from './playlistSelection.ts';
import { playlistsAtom } from '../playback/playlists.ts';
import { collectHandles, HANDLE_PAGE, type TrackRef } from './selectionHandles.ts';

/**
 * 内联发送的行数上限。超过就改调宿主的「发送到播放列表…」对话框，由它在内部复制，不把几万条路径塞过桥。
 */
export const SEND_TO_INLINE_LIMIT = 2000;
export const QUEUE_NEXT_BATCH = QUEUE_BATCH;
/** 追加到末尾：宿主把超过当前行数的位置截到末尾，不必先读行数。 */
const APPEND = 0x7fffffff;

export interface PlaylistTrackActionsFace {
  on: typeof fb.on;
  playlist: Pick<
    typeof fb.playlist,
    | 'getActive'
    | 'removeSelectedTracks'
    | 'sort'
    | 'shuffle'
    | 'reverse'
    | 'undo'
    | 'redo'
    | 'getTracks'
    | 'insertTracks'
    | 'create'
  >;
  queue: Pick<typeof fb.queue, 'getCount' | 'insertNext'>;
  menu: Pick<typeof fb.menu, 'runMainMenuCommand'>;
}

export interface PlaylistTrackActionsDeps {
  readonly selection: Pick<PlaylistSelectionService, 'settle'>;
}

export interface PlaylistTrackActions {
  /** 最近一次命令宿主没办成；下一次办成时收起。 */
  readonly failedAtom: Atom<boolean>;
  dismissFailure(): void;
  /**
   * 移除选中的曲目：按宿主那份选中删，十万行选中也是一次调用。先等选中推给宿主落地，没落地就不发。
   * 锁定的列表宿主答失败，按失败提示；Delete 键要静默，由调用方先按锁挡掉。
   */
  remove(guid: string): Promise<boolean>;
  /**
   * 只留选中的、删掉其余的：fb2k 的「裁剪」，按宿主那份选中做、只作用于活动列表。宿主那份若还停在旧的
   * 一批甚至是空的，删掉的就是用户没想删的，所以先等选中落地，再确认这张就是活动列表。
   */
  crop(guid: string): Promise<boolean>;
  /** 按 Title Formatting 串排宿主列表，可撤销。锁定的列表不排，也不提示。 */
  sort(guid: string, pattern: string, descending: boolean): Promise<boolean>;
  shuffle(guid: string): Promise<boolean>;
  reverse(guid: string): Promise<boolean>;
  /** 撤销、重做这张列表的上一步；没有可撤的、锁着的不提示。 */
  undo(guid: string): Promise<boolean>;
  redo(guid: string): Promise<boolean>;
  /** 按行序读取路径并插到队首，插播结束后继续原来源。 */
  queueNext(guid: string, ranges: SelectionRanges): Promise<boolean>;
  /** 追加到队列末尾。 */
  queueLast(guid: string, ranges: SelectionRanges): Promise<boolean>;
  /** 选中的行复制到另一张列表末尾。行数过了 `SEND_TO_INLINE_LIMIT` 不发，调用方改走宿主对话框。 */
  sendTo(guid: string, ranges: SelectionRanges, target: string): Promise<boolean>;
  /** 新建一张列表再复制进去；先收路径再建，读失败时不留下一张空列表。 */
  sendToNew(guid: string, ranges: SelectionRanges, name: string): Promise<boolean>;
}

/** 这张列表此刻的序号；不在清单里为 -1。 */
function indexOf(store: Store, guid: string): number {
  return store.get(playlistsAtom).items.find((item) => item.guid === guid)?.index ?? -1;
}

/**
 * 播放列表页曲目的命令：把「这一批」变成宿主调用。宿主各端点收的坐标不统一：移除与裁剪按宿主自己的选中，
 * 入队与复制都按区间分页读路径；读取期间来源被编辑就停止入队。
 *
 * 一律不乐观更新：删、排、入队之后的样子由宿主事件带回来（行服务按内容事件重取，选中跟着回查），这里只报
 * 成败。起播在 `PlaylistActions.play`，它还负责记下播放来源。
 */
export function createPlaylistTrackActions(
  store: Store,
  deps: PlaylistTrackActionsDeps,
  host: PlaylistTrackActionsFace = fb,
): PlaylistTrackActions {
  const failed = atom(false);

  async function run(
    command: () => Promise<{ success: boolean; code?: string }>,
    quiet: readonly string[] = [],
  ): Promise<boolean> {
    const answer = await settle(command);
    if (answer?.success === true) {
      store.set(failed, false);
      return true;
    }
    if (!quiet.includes(answer?.code ?? '')) store.set(failed, true);
    return false;
  }

  const fail = () => {
    store.set(failed, true);
    return false;
  };

  async function enqueue(guid: string, ranges: SelectionRanges, place: EnqueuePlace) {
    if (countRows(ranges) === 0) return false;
    const index = indexOf(store, guid);
    if (index < 0) return fail();
    let current = true;
    const invalidate = () => {
      current = false;
    };
    const offs = [
      ...(
        [
          'playlist:itemsAdded',
          'playlist:itemsRemoved',
          'playlist:itemsReordered',
          'playlist:itemsReplaced',
        ] as const
      ).map((event) =>
        host.on(event, ({ playlist }) => {
          if (playlist === index) invalidate();
        }),
      ),
      host.on('playlist:removed', invalidate),
      host.on('playlist:reordered', invalidate),
    ];
    try {
      // 句柄已带绝对路径和分轨身份，直接沿用宿主值，避免从显示路径重新拼接。
      const paths: string[] = [];
      for (const range of ranges) {
        for (let start = range.start; start < range.end; start += HANDLE_PAGE) {
          if (!current) return fail();
          const count = Math.min(HANDLE_PAGE, range.end - start);
          const page = await settle(() =>
            host.playlist.getTracks(guid, start, count, undefined, ['handle']),
          );
          if (!current || page?.success !== true || page.tracks.length !== count) return fail();
          for (const track of page.tracks) {
            if (!track.handle) return fail();
            paths.push(track.handle);
          }
        }
      }
      return await run(async () => ({
        success: await enqueuePaths(host, paths, place, () => current),
      }));
    } catch {
      return fail();
    } finally {
      offs.forEach((off) => off());
    }
  }

  /** 先收路径再动目标：读失败或列表途中变了就整批不发。 */
  async function send(
    guid: string,
    ranges: SelectionRanges,
    target: () => Promise<string | null>,
  ): Promise<boolean> {
    if (countRows(ranges) === 0 || countRows(ranges) > SEND_TO_INLINE_LIMIT) return false;
    let handles: TrackRef[];
    try {
      handles = await collectHandles(host.playlist, guid, ranges);
    } catch {
      return fail();
    }
    const into = await target();
    if (into === null) return fail();
    return run(() => host.playlist.insertTracks(into, APPEND, handles));
  }

  return {
    failedAtom: atom((get) => get(failed)),
    dismissFailure: () => store.set(failed, false),
    async remove(guid) {
      if (!(await deps.selection.settle(guid))) return fail();
      return run(() => host.playlist.removeSelectedTracks(guid));
    },
    async crop(guid) {
      if (!(await deps.selection.settle(guid))) return fail();
      return run(async () => {
        const active = await host.playlist.getActive();
        if (active.success === false || !active.found || active.guid !== guid) {
          return { success: false };
        }
        return host.menu.runMainMenuCommand(MAIN_COMMANDS.cropSelection);
      });
    },
    sort: (guid, pattern, descending) =>
      run(() => host.playlist.sort(guid, pattern, descending), ['LOCKED']),
    shuffle: (guid) => run(() => host.playlist.shuffle(guid), ['LOCKED']),
    reverse: (guid) => run(() => host.playlist.reverse(guid), ['LOCKED']),
    undo: (guid) => run(() => host.playlist.undo(guid), ['LOCKED', 'NOT_FOUND']),
    redo: (guid) => run(() => host.playlist.redo(guid), ['LOCKED', 'NOT_FOUND']),
    queueNext: (guid, ranges) => enqueue(guid, ranges, 'next'),
    queueLast: (guid, ranges) => enqueue(guid, ranges, 'last'),
    sendTo: (guid, ranges, target) => send(guid, ranges, () => Promise.resolve(target)),
    sendToNew: (guid, ranges, name) =>
      send(guid, ranges, async () => {
        const created = await settle(() => host.playlist.create(name));
        return created && created.success !== false ? created.guid : null;
      }),
  };
}
