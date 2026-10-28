import type { ApiFailure, Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { hostCommand, settle } from '../host/hostCall.ts';
import { waitForHost } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import {
  trackKeyOf,
  type PlaybackFace,
  type PlaybackService,
  type PlaybackState,
} from './playbackContract.ts';
import { bindPlaybackEvents } from './playbackEvents.ts';
import { isOrderName, type OrderName } from './playbackOrder.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';
import {
  onlineKey,
  onlineTracksAtom,
  withOnlineTrack,
  type OnlineTracksService,
} from './onlineTracks.ts';
import { createStopTransit } from './stopTransit.ts';
import { withStreamTrack, type StreamTrack } from './streamTrack.ts';
import { amplitudeOf, clamp, MUTE_DB } from './volumeScale.ts';

/** 跳回原位置后等待宿主进度推进的超时上限（毫秒，实测约 0.6 秒起步） */
const SETTLE_MS = 3000;
/** 判定进度有效推进的前置阈值（秒）：对齐帧边界时回报位置可能略微超前 */
const SETTLE_LEAD = 0.25;

const INITIAL: PlaybackState = {
  status: 'connecting',
  state: 'stopped',
  canSeek: false,
  resuming: false,
  track: null,
  trackGeneration: 0,
  position: 0,
  duration: 0,
  volume: 0,
  volumeDb: MUTE_DB,
  muted: false,
  order: null,
  failure: null,
};

const stateAtom = atom<PlaybackState>(INITIAL);
const trackStatusAtom = atom<'pending' | 'ready' | 'failed'>('pending');
/** 桥接就绪并不意味着曲目初读完毕；初读失败亦不可等同于空曲目 */
export const playbackTrackStatusAtom = atom((get) => get(trackStatusAtom));

export const playbackAtom: Atom<PlaybackState> = atom((get) => get(stateAtom));
/** 仅在换曲、编辑与停止时更新，避免高频（100 ms）进度刷新引发不必要的订阅重渲染 */
export const currentTrackAtom: Atom<Track | null> = atom((get) => get(stateAtom).track);
/** 当前在线曲目的 `onlineKey`；停止播放或非在线曲目时为 null */
export const playingOnlineKeyAtom: Atom<string | null> = atom((get) => {
  const track = get(currentTrackAtom);
  const ref = track ? readOnlineAddress(track.path)?.ref : undefined;
  return ref ? onlineKey(ref) : null;
});
export const playbackOrderAtom: Atom<OrderName | null> = atom((get) => get(stateAtom).order);
export const volumeDbAtom: Atom<number> = atom((get) => get(stateAtom).volumeDb);

type Domain = 'state' | 'track' | 'position' | 'volume' | 'order';

/**
 * 启动播放服务：先订阅事件后发起初读，统一同步至 `playbackAtom`
 * 所有控制命令均不做乐观更新，执行后按领域分通道回读；未连接宿主前拦截所有下发命令
 * 传入 `online` 服务时，在线曲目将异步拉取元数据并覆盖显示（`onlineTracks.ts`）
 */
export function startPlayback(
  store: Store,
  host: PlaybackFace = fb,
  online?: Pick<OnlineTracksService, 'want'>,
): PlaybackService {
  store.set(trackStatusAtom, 'pending');
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let init = 0;
  let unbind: (() => void) | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  let volumeWriting: Promise<void> | null = null;
  let pendingVolume: { db: number; refresh: boolean } | null = null;
  // 宿主原始曲目信息，以及由网络流媒体解析得到的元数据（`streamTrack.ts`）
  let tagged: Track | null = null;
  let stream: StreamTrack | null = null;
  // 换地址续播的暂留状态（`holdPosition`）：记录固定位置、目标曲目及可 seek 属性；`settling` 阶段已完成跳转
  let hold: { key: string; position: number; canSeek: boolean; settling: boolean } | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  // 停止状态回核不参与常规代次递增，避免紧随其后的 stateChanged 误作废读取结果
  const transit = createStopTransit(
    async () => {
      const answer = await settle(() => host.player.getState());
      return answer && answer.success !== false ? answer.state === 'stopped' : null;
    },
    () => {
      update({ state: 'stopped', canSeek: false });
      applyTrack(null);
    },
  );
  // 各领域独立维护代次以隔离过期响应；避免高频进度事件（1 Hz）意外作废曲目或音量的初读
  const generation: Record<Domain, number> = {
    state: 0,
    track: 0,
    position: 0,
    volume: 0,
    order: 0,
  };

  const update = (patch: Partial<PlaybackState>) => {
    if (!disposed) store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };
  /** 合并在线展示元数据与电台曲目信息，生成供界面渲染的曲目对象 */
  const display = (track: Track) =>
    withStreamTrack(withOnlineTrack(track, store.get(onlineTracksAtom)), stream, trackKeyOf(track));
  // 在线元数据异步到达后重新合并视图，不视为切歌事件
  const offOnline = store.sub(onlineTracksAtom, () => {
    if (tagged && readOnlineAddress(tagged.path)) update({ track: display(tagged) });
  });
  const connected = () => !disposed && store.get(stateAtom).status === 'connected';
  const bump = (domain: Domain) => ++generation[domain];

  /** 续播暂留期间记录宿主的可 seek 属性，界面侧对外报告不可拖动 */
  function seekable(canSeek: boolean): boolean {
    if (!hold) return canSeek;
    hold.canSeek = canSeek;
    return false;
  }

  /** 解除暂留状态：传入 `position` 时同步交回，缺省时回读宿主真实位置 */
  function endHold(position?: number): void {
    if (!hold) return;
    const { canSeek } = hold;
    hold = null;
    clearTimeout(settleTimer);
    bump('position');
    update({ resuming: false, canSeek, ...(position === undefined ? {} : { position }) });
    if (position === undefined) void readPosition();
  }

  /** 读取指定领域状态：丢弃晚于同领域更新的过期响应；读取失败仅记录故障类型，保留既有状态 */
  async function read<T extends { success: true }>(
    domain: Domain,
    call: () => Promise<T | ApiFailure>,
    apply: (answer: T) => void,
  ): Promise<void> {
    const mine = bump(domain);
    const answer = await settle(call);
    if (disposed || mine !== generation[domain]) return;
    if (answer === null || answer.success === false) {
      update({ failure: 'read' });
      if (domain === 'track' && store.get(trackStatusAtom) !== 'ready')
        store.set(trackStatusAtom, 'failed');
    } else apply(answer);
  }

  /**
   * 更新曲目状态并合并元数据。`fresh` 为 true 表示开启新播放轮次（同曲重播亦作为切歌处理，
   * 进度归零）；电台广播的曲名与艺人在此处叠加
   */
  function applyTrack(track: Track | null, fresh = false): void {
    const key = trackKeyOf(track);
    const changed = fresh || key !== trackKeyOf(store.get(stateAtom).track);
    tagged = track;
    if (changed) stream = null;
    if (!track) {
      // 停止播放或无曲目时清空展示并作废在途进度；音量与播放顺序保持不变
      bump('position');
      update({ track: null, position: 0, duration: 0 });
      store.set(trackStatusAtom, 'ready');
      return;
    }
    const shown = display(track);
    const address = changed ? readOnlineAddress(track.path) : null;
    if (address) online?.want([address.ref]);
    if (!changed) {
      update({ track: shown });
      store.set(trackStatusAtom, 'ready');
      return;
    }
    update({
      track: shown,
      trackGeneration: store.get(stateAtom).trackGeneration + 1,
      position: 0,
      duration: track.duration,
    });
    store.set(trackStatusAtom, 'ready');
    void readPosition();
  }

  // 播放状态与 seek 能力同属状态领域：宿主 stateChanged 同步回报两项，过期响应整条作废
  const readState = () =>
    read(
      'state',
      () => host.player.getState(),
      (answer) => update({ state: answer.state, canSeek: seekable(answer.canSeek) }),
    );
  // `found: false` 表示当前无播放曲目（非断连错误）；切歌过渡期新曲尚未打开时不提前清空展示
  const readTrack = () =>
    read(
      'track',
      () => host.player.getCurrentTrack(),
      (answer) => {
        const track = answer.found && answer.track ? answer.track : null;
        if (track || transit.phase() !== 'switching') applyTrack(track);
      },
    );
  const readVolume = () =>
    read(
      'volume',
      () => host.player.getVolume(),
      (answer) =>
        update({
          volume: clamp(answer.volume, 0, 100),
          volumeDb: answer.volumeDb,
          muted: answer.muted,
        }),
    );
  const readOrder = () =>
    read(
      'order',
      () => host.player.getOrder(),
      (answer) => update({ order: isOrderName(answer.name) ? answer.name : null }),
    );

  /** 读取当前播放进度：若响应中的曲目标识与当前曲目不符，判定为过期切歌数据并丢弃 */
  async function readPosition(): Promise<void> {
    if (!store.get(stateAtom).track) return;
    await read(
      'position',
      () => host.player.getPosition(),
      (answer) => {
        if (
          hold ||
          transit.phase() !== 'steady' ||
          trackKeyOf(answer) !== trackKeyOf(store.get(stateAtom).track)
        )
          return;
        update({
          position: answer.position,
          ...(answer.duration > 0 ? { duration: answer.duration } : {}),
        });
      },
    );
  }

  function refreshAll(): void {
    void readState();
    void readTrack();
    void readVolume();
    void readOrder();
  }

  function bind(): void {
    unbind?.();
    const starting = () => {
      const opening = transit.phase() !== 'switching';
      transit.starting();
      bump('position');
      // 手动切歌时宿主先报 starting，解码器打开新曲目后才报 trackChanged；位置时钟在 starting 带来的 stateChanged
      // 里就归零了，等 trackChanged 才开新一轮，进度条早被时钟拽到 0，归零缓动没了起点。所以新一轮从这里起算。
      // 换地址续播（暂留）期间的 starting 是同一首换了地址，进度要停在原位，不算
      if (opening && !hold && store.get(stateAtom).track)
        update({ trackGeneration: store.get(stateAtom).trackGeneration + 1 });
    };
    unbind = bindPlaybackEvents(host, {
      // 新曲目的 seek 能力由随后的 stateChanged 事件带回，此处不发起额外读取
      trackChanged: (track) => {
        transit.arrived();
        bump('track');
        // 续播暂留期间切换至同曲目的新地址不视作新播放轮次，保持既有进度与时长
        if (hold && trackKeyOf(track) === hold.key) {
          tagged = track;
          update({ track: display(track) });
          return;
        }
        endHold();
        // trackChanged 事件标志新播放轮次开始，同路径的循环播放重置进度；元数据修改走 edited 事件
        applyTrack(track, true);
      },
      edited: (track) => {
        if (trackKeyOf(track) !== trackKeyOf(store.get(stateAtom).track)) return;
        bump('track');
        applyTrack(track);
      },
      streamTrack: (payload) => {
        if (!tagged) return;
        const key = trackKeyOf(tagged);
        stream = { ...payload, key };
        bump('track');
        update({ track: display(tagged) });
      },
      starting,
      stopped: (reason) => {
        // 连续切歌时的过渡停止不清空展示（宿主亦不广播 stopped 状态）；其余停止事件进入状态确认流程（`stopTransit.ts`）
        if (reason === 'starting_another') {
          starting();
          return;
        }
        endHold();
        bump('track');
        bump('state');
        transit.stopped();
      },
      paused: (paused) => {
        bump('state');
        update({ state: paused ? 'paused' : 'playing' });
      },
      stateChanged: ({ state, position, duration, canSeek }) => {
        bump('state');
        if (transit.phase() !== 'steady') {
          // 处于过渡阶段时停止由确认流程判定；若回报播放中则视为切歌，仅更新状态与 seek 能力
          if (state === 'stopped') return;
          transit.starting();
          update({ state, canSeek: seekable(canSeek) });
          return;
        }
        // 续播暂留期间进度与总时长不跟随宿主变动
        if (hold) {
          update({ state, canSeek: seekable(canSeek) });
          return;
        }
        bump('position');
        update({ state, position, duration, canSeek });
      },
      positionChanged: (position) => {
        if (hold) {
          if (hold.settling && position > hold.position + SETTLE_LEAD) endHold(position);
          return;
        }
        if (transit.phase() === 'steady') {
          bump('position');
          update({ position });
        }
      },
      volumeChanged: ({ volume, volumeDb, muted }) => {
        bump('volume');
        update({ volume: clamp(volume, 0, 100), volumeDb, muted });
      },
      orderChanged: () => void readOrder(),
    });
  }

  async function start(): Promise<void> {
    const mine = ++init;
    waiter?.cancel();
    waiter = waitForHost(host);
    const arrived = await waiter.done;
    if (disposed || mine !== init) return;
    if (!arrived) {
      update({ status: 'disconnected' });
      return;
    }
    // 遵循先订阅事件后发起初读的时序，避免漏掉初始化窗口期的状态变更
    bind();
    update({ status: 'connected' });
    refreshAll();
  }

  async function command(
    call: () => Promise<{ success: boolean }>,
    refresh?: () => void,
  ): Promise<void> {
    if (!connected()) return;
    if (!(await hostCommand(call))) update({ failure: 'command' });
    if (!disposed) refresh?.();
  }

  const refreshTransport = () => {
    void readState();
    void readTrack();
  };

  async function drainVolume(): Promise<void> {
    let refresh = false;
    while (pendingVolume && !disposed) {
      const next = pendingVolume;
      pendingVolume = null;
      refresh ||= next.refresh;
      await command(() => host.player.setVolume(amplitudeOf(next.db)));
    }
    volumeWriting = null;
    if (refresh && !disposed) void readVolume();
  }

  return {
    ready: start(),
    playOrPause: () => command(() => host.player.toggle(), refreshTransport),
    stop: () => command(() => host.player.stop(), refreshTransport),
    next: () => command(() => host.player.next(), refreshTransport),
    previous: () => command(() => host.player.prev(), refreshTransport),
    seek: async (seconds) => {
      if (!connected()) return;
      await command(() => host.player.seek(clamp(seconds, 0, store.get(stateAtom).duration)));
      if (!disposed) await readPosition();
    },
    setVolume(db, refresh = true) {
      if (!connected()) return Promise.resolve();
      pendingVolume = { db, refresh: refresh || (pendingVolume?.refresh ?? false) };
      volumeWriting ??= drainVolume();
      return volumeWriting;
    },
    stepVolume: (up) => command(() => (up ? host.player.volumeUp() : host.player.volumeDown())),
    toggleMute: () =>
      command(
        () => host.player.toggleMute(),
        () => void readVolume(),
      ),
    setOrder: (order) =>
      command(
        () => host.player.setOrder(order),
        () => void readOrder(),
      ),
    holdPosition(position) {
      const state = store.get(stateAtom);
      if (disposed || !state.track) return () => {};
      const mine = {
        key: trackKeyOf(state.track),
        position,
        canSeek: hold?.canSeek ?? state.canSeek,
        settling: false,
      };
      hold = mine;
      clearTimeout(settleTimer);
      bump('position');
      update({ position, resuming: true, canSeek: false });
      return (resumed) => {
        if (hold !== mine) return;
        if (!resumed) {
          endHold();
          return;
        }
        mine.settling = true;
        settleTimer = setTimeout(() => {
          if (hold === mine) endHold();
        }, SETTLE_MS);
      };
    },
    retry() {
      if (disposed) return;
      update({ failure: null });
      if (connected()) refreshAll();
      else void start();
    },
    dismissFailure: () => update({ failure: null }),
    dispose() {
      disposed = true;
      clearTimeout(settleTimer);
      pendingVolume = null;
      init += 1;
      transit.dispose();
      offOnline();
      unbind?.();
      unbind = undefined;
      waiter?.cancel();
    },
  };
}
