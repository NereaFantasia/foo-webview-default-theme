import type { PlaylistGetPlayingResponse, PlaylistInfo } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../host/hostCall.ts';
import { isHostPlaylist } from '../host/hostPlaylists.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 播放列表清单：有哪些、哪张是活动的、哪张在播放。宿主没有「清单变了」的专门事件，按事件重读整份：
 *
 * - 建、删、改名、重排、激活、锁变了：立即重读。
 * - 行尾的曲目数跟着 itemsAdded / itemsRemoved / itemsReplaced 变；itemsReordered 不改数，不订。
 * - 「正在播放」只在换曲与停止时变，没有对应的 playlist 事件。`getAll` 的 isPlaying 出自宿主的清单
 *   缓存，只有列表事件才让它失效（插件 `Fb2kPlaylistService::get_all_playlists`），换曲后重读拿到的
 *   还是旧的；所以每次读清单都另问一次不走缓存的 `getPlaying`，按 GUID 覆写 isPlaying，
 *   playback:trackChanged 与 playback:stopped 到时只问 `getPlaying`。换曲时先来 stopped 再来 trackChanged。
 *
 * 后两类会连发，合并 `COALESCE_MS` 读一次。读回按代次丢弃晚到的旧应答。
 *
 * 序号随增删、重排变，认列表一律按宿主给的 GUID；按列表发的命令也带 GUID（`PlaylistRef` 传字符串）。
 * 宿主自己建的几张（`hostPlaylists.ts`）不进清单，只记下序号。
 */
export interface PlaylistsFace extends HostReadyFace {
  on: typeof fb.on;
  playlist: Pick<typeof fb.playlist, 'getAll' | 'getPlaying' | 'setActive'>;
}

/** 内容与播放事件的合并窗口，毫秒。 */
export const COALESCE_MS = 150;

const LIST_EVENTS = [
  'playlist:created',
  'playlist:removed',
  'playlist:renamed',
  'playlist:reordered',
  'playlist:activated',
  'playlist:lockChanged',
] as const;
const ITEM_EVENTS = [
  'playlist:itemsAdded',
  'playlist:itemsRemoved',
  'playlist:itemsReplaced',
] as const;
const PLAYBACK_EVENTS = ['playback:trackChanged', 'playback:stopped'] as const;

export interface PlaylistsState {
  readonly status: 'connecting' | 'connected' | 'disconnected';
  /** 按序号排。宿主自己建的几张不在里面，位置因此不一定等于序号。 */
  readonly items: readonly PlaylistInfo[];
  /**
   * 宿主自己建的那几张的序号，从小到大。只给按宿主序号算位置的地方用：重排要发包含全部列表的排列，
   * 定位时要认出在播的是它们。
   */
  readonly hiddenIndices: readonly number[];
  /** 活动列表的 GUID，按宿主标的 `isActive` 认；没有活动列表、或活动的是宿主自己建的那几张时为 null。 */
  readonly activeGuid: string | null;
  /** 读清单失败了；下一次读成功时收起。 */
  readonly readFailed: boolean;
  /** 切换活动列表被拒了；之后一次切换成功时收起。与读清单的失败分开记，互不覆盖。 */
  readonly activateFailed: boolean;
  /** 成功读回清单的次数。 */
  readonly revision: number;
}

const INITIAL: PlaylistsState = {
  status: 'connecting',
  items: [],
  hiddenIndices: [],
  activeGuid: null,
  readFailed: false,
  activateFailed: false,
  revision: 0,
};

const stateAtom = atom<PlaylistsState>(INITIAL);

export const playlistsAtom: Atom<PlaylistsState> = atom((get) => get(stateAtom));

export interface PlaylistsService {
  readonly ready: Promise<void>;
  /**
   * 切换活动列表，答宿主收没收。不乐观更新：高亮等宿主的 `playlist:activated` 带回清单再变。
   * 目标已经是它就不发：比的是最近一次还没在清单里看到结果的请求，没有这样的请求才比活动列表。
   * 失败只在它仍是最近一次请求时记下；之后又切了别的，旧请求的失败不报。之后一次切换成功，
   * 切换失败的提示随之收起。
   */
  activate(guid: string): Promise<boolean>;
  /**
   * 最近一次切换要去的那张：宿主还没答、答了但清单还没读回、被拒了而活动列表还没变，这三种时候答它的
   * GUID，其余答 null。页面此刻的主体按它报，读回之前活动列表还是旧的。
   */
  requestedTarget(): string | null;
  /** 现读一次，兑现时最新的一次读已经读回来（成败都算）。宿主改了清单、要等读回再往下走时用。 */
  refresh(): Promise<void>;
  /** 收起一种失败的提示；不给就两种都收起。 */
  dismissFailure(kind?: 'read' | 'activate'): void;
  dispose(): void;
}

/** 一次切换活动列表的请求。`from` 是发出时的活动列表。 */
interface ActivateRequest {
  readonly guid: string;
  readonly from: string | null;
  state: 'sent' | 'answered' | 'failed';
}

/** 读回的清单是否已含这次请求的结果；被拒的请求等活动列表变了才算完。 */
function settledBy(request: ActivateRequest, activeGuid: string | null): boolean {
  if (request.state === 'failed') return activeGuid !== request.from;
  return request.state === 'answered' || request.guid === activeGuid;
}

/** 按 `getPlaying` 的应答覆写 isPlaying；没拿到应答就照清单里的。 */
function withPlaying(
  items: readonly PlaylistInfo[],
  playing: PlaylistGetPlayingResponse | null,
): readonly PlaylistInfo[] {
  if (!playing || playing.success === false) return items;
  const guid = playing.found ? playing.guid : undefined;
  return items.map((item) =>
    item.isPlaying === (item.guid === guid) ? item : { ...item, isPlaying: item.guid === guid },
  );
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function startPlaylists(store: Store, host: PlaylistsFace = fb): PlaylistsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let generation = 0;
  let latest: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let playingTimer: ReturnType<typeof setTimeout> | undefined;
  // 最近一次切换请求。点了 B、宿主还没回，再点回 A 时活动列表仍是 A，按它比就会漏发、停在 B。
  // 宿主按先后作答：答了之后读回的清单一定已含这次切换，那时起按活动列表比。被拒的请求留到活动列表
  // 变了为止（`from` 是发出时的活动列表），只供 `requestedTarget` 报；比「已是这张就不发」时不算它，
  // 同一张照样发。
  let requested: ActivateRequest | null = null;
  // 最近发出的那一次，读回不清它：读回可能先于应答到，那时 `requested` 已清掉，应答仍要照常收。
  let lastRequest: ActivateRequest | null = null;
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  const update = (patch: Partial<PlaylistsState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  const connected = () => !disposed && store.get(stateAtom).status === 'connected';
  const clearActivateFailure = () => {
    if (store.get(stateAtom).activateFailed) update({ activateFailed: false });
  };

  async function readOnce(): Promise<void> {
    if (!connected()) return;
    const mine = ++generation;
    const answer = await settle(() => host.playlist.getAll());
    if (disposed || mine !== generation) return;
    if (!answer || answer.success === false) {
      update({ readFailed: true });
      return;
    }
    const playing = await settle(() => host.playlist.getPlaying());
    if (disposed || mine !== generation) return;
    const sorted = [...answer.playlists].sort((a, b) => a.index - b.index);
    const items = withPlaying(
      sorted.filter((item) => !isHostPlaylist(item.name)),
      playing,
    );
    const hidden = sorted.filter((item) => isHostPlaylist(item.name)).map((item) => item.index);
    const activeGuid = items.find((item) => item.isActive)?.guid ?? null;
    if (requested && settledBy(requested, activeGuid)) requested = null;
    const state = store.get(stateAtom);
    update({
      items: sameItems(state.items, items) ? state.items : items,
      hiddenIndices: sameItems(state.hiddenIndices, hidden) ? state.hiddenIndices : hidden,
      activeGuid,
      readFailed: false,
      revision: state.revision + 1,
    });
  }

  function read(): Promise<void> {
    latest = readOnce();
    return latest;
  }

  function readCoalesced(): void {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void read();
    }, COALESCE_MS);
  }

  // 只问正在播放的是哪张；这期间有一次读清单开始了，交给它带回来的为准。
  async function readPlaying(): Promise<void> {
    if (!connected()) return;
    const mine = generation;
    const playing = await settle(() => host.playlist.getPlaying());
    if (disposed || mine !== generation) return;
    const { items } = store.get(stateAtom);
    const next = withPlaying(items, playing);
    if (!sameItems(items, next)) update({ items: next });
  }

  function readPlayingCoalesced(): void {
    if (playingTimer !== undefined) return;
    playingTimer = setTimeout(() => {
      playingTimer = undefined;
      void readPlaying();
    }, COALESCE_MS);
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      update({ status: 'disconnected' });
      return;
    }
    // 先订阅再初读，两者之间的变化才不会漏。
    for (const event of LIST_EVENTS) offs.push(host.on(event, () => void read()));
    for (const event of ITEM_EVENTS) offs.push(host.on(event, readCoalesced));
    for (const event of PLAYBACK_EVENTS) offs.push(host.on(event, readPlayingCoalesced));
    update({ status: 'connected' });
    await read();
  }

  return {
    ready: connect(),
    async activate(guid) {
      if (!connected()) return false;
      if (requested?.state === 'failed') requested = null;
      const { activeGuid } = store.get(stateAtom);
      // 要去的已经是它：不发，但也算切换成功，切换失败的提示照样收起。
      if (guid === (requested?.guid ?? activeGuid)) {
        clearActivateFailure();
        return true;
      }
      const mine: ActivateRequest = { guid, from: activeGuid, state: 'sent' };
      requested = mine;
      lastRequest = mine;
      const ok = await hostCommand(() => host.playlist.setActive(guid));
      // 这期间又点了别的：用户要的已经是那一张，这次的成败不报。
      if (lastRequest !== mine) return ok;
      mine.state = ok ? 'answered' : 'failed';
      if (!ok) update({ activateFailed: true });
      else clearActivateFailure();
      return ok;
    },
    requestedTarget: () => requested?.guid ?? null,
    async refresh() {
      let current = read();
      // 这一次读被更新的一次顶掉时，接着等那一次，直到手上的就是最新的。
      for (;;) {
        await current;
        if (current === latest) return;
        current = latest;
      }
    },
    dismissFailure: (kind) =>
      update({
        ...(kind !== 'activate' ? { readFailed: false } : {}),
        ...(kind !== 'read' ? { activateFailed: false } : {}),
      }),
    dispose() {
      disposed = true;
      generation += 1;
      waiter.cancel();
      if (timer !== undefined) clearTimeout(timer);
      if (playingTimer !== undefined) clearTimeout(playingTimer);
      for (const off of offs.splice(0)) off();
    },
  };
}

export const playlistsKey = serviceKey<PlaylistsService>('playlists');
