import type { PlaylistInfo } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../host/hostCall.ts';
import { playKeepingQueue, type QueueCommandsFace } from '../host/queueCommands.ts';
import { translateAtom } from '../i18n/locale.ts';
import { LIBRARY_VIEW_PLAYLIST } from '../playback/libraryView.ts';
import type { PlaybackSourceService } from '../playback/playbackSource.ts';
import type { Store } from '../kit/store.ts';
import type { PlaylistPlaces } from './playlistPlaces.ts';
import { playlistsAtom, type PlaylistsService } from '../playback/playlists.ts';
import { hostOrder, moveOrder } from './sidebar/playlistReorder.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 侧边栏播放列表节的动作：把「这一张」变成宿主调用，失败收在一处。
 *
 * 目标一律按 GUID 给、按 GUID 发（`PlaylistRef` 传字符串）：菜单开着、确认框开着、改名框开着的时候，
 * 别处可能删了或挪了列表，序号会指到另一张上。GUID 在此刻的清单里认不回来就不发，记一笔失败。
 *
 * 载入、保存、去重、去无效条目是主菜单的标准命令，按命令 GUID 经 `menu.runMainMenuCommand` 执行，
 * 只作用于活动列表：目标不是活动列表就不发，也不替用户先切过去（切了会换掉正在看的内容，而右键一张
 * 列表本没打算去那里），菜单按同一判据置灰。清单里记的活动列表可能已过期（切换还没读回来、读清单失败、
 * 别处切走了），发之前现问一次宿主，活动的不是这张就不发，按失败报。
 *
 * 一律不乐观更新：列表集的变化由 playlist 事件带回清单重读，这里只报成败。
 */
export interface PlaylistActionsFace {
  queue: QueueCommandsFace['queue'];
  playlist: Pick<
    typeof fb.playlist,
    | 'create'
    | 'getActive'
    | 'getAll'
    | 'getTracks'
    | 'rename'
    | 'remove'
    | 'duplicate'
    | 'clear'
    | 'playTrack'
    | 'removeAutoplaylist'
    | 'reorderPlaylists'
  >;
  menu: Pick<typeof fb.menu, 'runMainMenuCommand'>;
}

/**
 * 主菜单标准命令的 GUID，取自 foobar2000 SDK `guids.cpp` 的 `standard_commands`，跨版本、跨语言不变。
 * 载入与保存全部是全局的，其余只作用于活动列表；裁剪按活动列表的宿主选中做。
 */
export const MAIN_COMMANDS = {
  loadPlaylist: '{D94393D4-9DBB-4E5C-BE8C-BE9CA80E214D}',
  saveAllPlaylists: '{0FDCFC65-9B39-445A-AA88-4D245F217480}',
  savePlaylist: '{370B720B-4CF7-465B-908C-2D2ADD027900}',
  removeDuplicates: '{D08C2921-7750-4979-98F9-3A513A31FF96}',
  removeDeadEntries: '{C297BADB-8098-45A9-A5E8-B53A0D780CE3}',
  /** 「裁剪」：只留宿主选中的那些，删掉列表里其余的曲目。 */
  cropSelection: '{383D4E8D-7E30-4FB8-B5DD-8C975D89E58E}',
} as const;

/** 新列表的名字：重名就加「 (2)」「 (3)」…，直到不重。 */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!names.has(candidate)) return candidate;
  }
}

/**
 * 最近一次动作为什么没成：`command` 是宿主只说了「没成」；`convert` 是那张智能列表归别的组件管，
 * 宿主放不开它。
 */
export type PlaylistActionFailure = 'command' | 'convert';

const failureAtom = atom<PlaylistActionFailure | null>(null);

/** 最近一次动作失败了；之后一次动作成功就清掉。 */
export const playlistActionFailureAtom: Atom<PlaylistActionFailure | null> = atom((get) =>
  get(failureAtom),
);

export interface PlaylistActions {
  /** 新列表的缺省名：与此刻清单里的名字都不重。 */
  newName(): string;
  /**
   * 按这个名字新建一张（去掉两端空白；不给或空了就用缺省名），去它的地点并切成活动列表，等清单读回
   * 再答新列表的 GUID。失败、上一次新建还没读回、读回的清单里没有它（读失败）时答 null。进行中再点
   * 不接：缺省名按清单去重，清单没读回就会重名。
   */
  create(name?: string): Promise<string | null>;
  /** 名字去掉两端空白；空名或没改都当取消，不发请求。 */
  rename(guid: string, name: string): Promise<boolean>;
  /** 复制一张，名字由宿主起。不切过去。 */
  duplicate(guid: string): Promise<boolean>;
  /**
   * 宿主没有回收站，删了就没了；要不要先确认由调用方按曲目数定。删的是活动列表时，清单读回后切到落在
   * 同一位的那张。
   */
  remove(guid: string): Promise<boolean>;
  clear(guid: string): Promise<boolean>;
  /**
   * 去它的地点、切成活动列表，从第 `row` 行（缺省第一首）播；没有那一行不发。宿主收下后把这张记成播放
   * 来源；专用列表 `[Library View]` 不记，它装的是从媒体库起播的那一批，来源由播放来源服务按在播的表认。
   */
  play(guid: string, row?: number): Promise<boolean>;
  /** 智能列表去掉查询、留下曲目，变成普通列表。别的组件管的智能列表放不开，记一笔 `convert`。 */
  convertToPlain(guid: string): Promise<boolean>;
  /**
   * 把这张挪到插入位 `slot`（0…n），按此刻的完整清单算排列，一次发出；落在原位不发。
   * 上一次重排的结果还没读回时不接：排列是按清单算的，清单还是旧的，算出来的就是错的。读回失败时
   * 一直不接，直到下一次读清单成功。
   */
  reorder(guid: string, slot: number): Promise<boolean>;
  removeDuplicates(guid: string): Promise<boolean>;
  removeDeadEntries(guid: string): Promise<boolean>;
  /** 宿主的保存对话框。载入、保存全部同样弹对话框，久开不关导致的调用超时不算失败。 */
  savePlaylist(guid: string): Promise<boolean>;
  loadPlaylist(): Promise<boolean>;
  saveAllPlaylists(): Promise<boolean>;
  dismissFailure(): void;
}

export function createPlaylistActions(
  store: Store,
  places: Pick<PlaylistPlaces, 'open'>,
  playlists: Pick<PlaylistsService, 'refresh' | 'activate'>,
  host: PlaylistActionsFace = fb,
  source: Pick<PlaybackSourceService, 'record'> | null = null,
): PlaylistActions {
  store.set(failureAtom, null);
  let creating = false;
  let reordering = false;
  // 重排成功而随后的读清单失败时，清单停在挪动之前。记下那时的读回次数，之后有一次读回成功才再接重排。
  let staleAt: number | null = null;
  const lists = () => store.get(playlistsAtom);
  const fail = (failure: PlaylistActionFailure = 'command') => {
    store.set(failureAtom, failure);
    return false;
  };

  const succeed = () => {
    store.set(failureAtom, null);
    return true;
  };

  /** 跑一条命令，失败记一笔、成功清掉上一笔。没连上宿主时什么都不发。 */
  async function run(command: () => Promise<{ success: boolean }>): Promise<boolean> {
    if (lists().status !== 'connected') return false;
    return (await hostCommand(command)) ? succeed() : fail();
  }

  /**
   * 跑一条会弹宿主对话框的命令（载入、保存）。宿主同步执行，对话框关掉之前不作答，开过 30 s 调用就
   * reject，这时并不知道成没成，不记失败；宿主答了 `success: false` 才记。
   */
  async function runDialog(command: () => Promise<{ success: boolean }>): Promise<boolean> {
    if (lists().status !== 'connected') return false;
    const answer = await settle(command);
    if (answer === null) return false;
    return answer.success ? succeed() : fail();
  }

  /** 按 GUID 认回目标再跑；认不回来（删了）不发，记一笔。 */
  function on(
    guid: string,
    allowed: (entry: PlaylistInfo) => boolean,
    command: (entry: PlaylistInfo) => Promise<{ success: boolean }>,
    runner: typeof run = run,
  ): Promise<boolean> {
    const entry = lists().items.find((item) => item.guid === guid);
    if (!entry) return Promise.resolve(fail());
    return allowed(entry) ? runner(() => command(entry)) : Promise.resolve(false);
  }
  const any = () => true;
  // 锁定的列表（智能列表也锁着）改不了内容，按锁挡掉；改名、删除与重排不看锁。
  const unlocked = (entry: PlaylistInfo) => !entry.isLocked;
  const active = (entry: PlaylistInfo) => entry.guid === lists().activeGuid;
  const mainCommand = (guid: string) => () => host.menu.runMainMenuCommand(guid);
  // 与专辑菜单「发送到新列表」同一个缺省名，两处建出来的列表不该一处一个叫法。
  const newName = () =>
    uniqueName(
      store.get(translateAtom)('album.newPlaylist'),
      lists().items.map((item) => item.name),
    );
  const onActiveList = (target: string, command: string) => async () => {
    const now = await settle(() => host.playlist.getActive());
    if (!now || now.success === false || !now.found || now.guid !== target) {
      return { success: false };
    }
    return host.menu.runMainMenuCommand(command);
  };

  return {
    newName,
    async create(name = '') {
      if (creating || lists().status !== 'connected') return null;
      creating = true;
      try {
        const trimmed = name.trim();
        const answer = await settle(() => host.playlist.create(trimmed || newName()));
        if (!answer || answer.success === false) {
          fail();
          return null;
        }
        succeed();
        places.open(answer.guid);
        await playlists.refresh();
        return lists().items.some((item) => item.guid === answer.guid) ? answer.guid : null;
      } finally {
        creating = false;
      }
    },
    rename(guid, name) {
      const trimmed = name.trim();
      return on(
        guid,
        (entry) => trimmed !== '' && trimmed !== entry.name,
        () => host.playlist.rename(guid, trimmed),
      );
    },
    duplicate: (guid) => on(guid, any, () => host.playlist.duplicate(guid)),
    async remove(guid) {
      const at = lists().items.findIndex((item) => item.guid === guid);
      const wasActive = at >= 0 && guid === lists().activeGuid;
      const ok = await on(guid, any, () => host.playlist.remove(guid));
      if (!ok || !wasActive) return ok;
      // 宿主的删除不切换活动列表，删掉活动的那张后一张都不活动，只作用于活动列表的命令全都用不了。
      // 照 foobar2000 自己删列表的做法，切到落在同一位的那张（删的是最后一张就切到新的最后一张）。
      await playlists.refresh();
      const { items, activeGuid } = lists();
      const next = items[Math.min(at, items.length - 1)];
      if (activeGuid === null && next) void playlists.activate(next.guid);
      return ok;
    },
    clear: (guid) => on(guid, unlocked, () => host.playlist.clear(guid)),
    async play(guid, row = 0) {
      const entry = lists().items.find((item) => item.guid === guid);
      const ok = await on(
        guid,
        (item) => Number.isInteger(row) && row >= 0 && item.trackCount > row,
        async () => {
          places.open(guid);
          return { success: await playKeepingQueue(host, guid, row) };
        },
      );
      if (ok && entry && entry.name !== LIBRARY_VIEW_PLAYLIST) {
        source?.record({ kind: 'playlist', subject: guid, name: entry.name });
      }
      return ok;
    },
    async convertToPlain(guid) {
      const entry = lists().items.find((item) => item.guid === guid);
      if (!entry) return fail();
      if (!entry.isAutoplaylist || lists().status !== 'connected') return false;
      const answer = await settle(() => host.playlist.removeAutoplaylist(guid));
      if (!answer || answer.success === false) return fail();
      // 别的组件管的智能列表宿主放不开：照样答成功，只是 source 为 dui，什么都没改。
      return answer.source === 'dui' ? fail('convert') : succeed();
    },
    async reorder(guid, slot) {
      if (reordering || (staleAt !== null && lists().revision <= staleAt)) return false;
      const { items, hiddenIndices } = lists();
      const from = items.findIndex((item) => item.guid === guid);
      if (from < 0) return fail();
      const moved = moveOrder(items.length, from, slot);
      if (!moved) return false;
      const listed = items.map((item) => item.index);
      const order = hostOrder(moved, listed, items.length + hiddenIndices.length);
      reordering = true;
      try {
        const ok = await run(() => host.playlist.reorderPlaylists(order));
        if (ok) {
          // 应答之后读回来的清单，宿主都是在重排之后处理的，一定已经是挪过的。
          const answeredAt = lists().revision;
          await playlists.refresh();
          staleAt = lists().revision > answeredAt ? null : answeredAt;
        }
        return ok;
      } finally {
        reordering = false;
      }
    },
    removeDuplicates: (guid) =>
      on(
        guid,
        (entry) => unlocked(entry) && active(entry),
        onActiveList(guid, MAIN_COMMANDS.removeDuplicates),
      ),
    removeDeadEntries: (guid) =>
      on(
        guid,
        (entry) => unlocked(entry) && active(entry),
        onActiveList(guid, MAIN_COMMANDS.removeDeadEntries),
      ),
    savePlaylist: (guid) =>
      on(guid, active, onActiveList(guid, MAIN_COMMANDS.savePlaylist), runDialog),
    loadPlaylist: () => runDialog(mainCommand(MAIN_COMMANDS.loadPlaylist)),
    saveAllPlaylists: () => runDialog(mainCommand(MAIN_COMMANDS.saveAllPlaylists)),
    dismissFailure: () => store.set(failureAtom, null),
  };
}

export const playlistActionsKey = serviceKey<PlaylistActions>('playlistActions');
