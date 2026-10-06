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
import { createStopTransit } from './stopTransit.ts';
import { withStreamTrack, type StreamTrack } from './streamTrack.ts';
import { amplitudeOf, clamp, MUTE_DB } from './volumeScale.ts';

const INITIAL: PlaybackState = {
  status: 'connecting',
  state: 'stopped',
  canSeek: false,
  track: null,
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
/** 连上桥接不代表曲目初读已完成；初读失败也不能冒充确认无曲目。 */
export const playbackTrackStatusAtom = atom((get) => get(trackStatusAtom));

export const playbackAtom: Atom<PlaybackState> = atom((get) => get(stateAtom));
/** 只在换曲、编辑与停止时变：订阅它的人不会被每 100 ms 一次的进度更新叫醒。 */
export const currentTrackAtom: Atom<Track | null> = atom((get) => get(stateAtom).track);
export const playbackOrderAtom: Atom<OrderName | null> = atom((get) => get(stateAtom).order);
export const volumeDbAtom: Atom<number> = atom((get) => get(stateAtom).volumeDb);

type Domain = 'state' | 'track' | 'position' | 'volume' | 'order';

/**
 * 启动播放服务：先订阅再初读，事件与回读都写进 `playbackAtom`。命令一律不做乐观更新，
 * 执行后按领域回读；宿主缺席时一条命令都不发，先过「已连接」闸。
 */
export function startPlayback(store: Store, host: PlaybackFace = fb): PlaybackService {
  store.set(trackStatusAtom, 'pending');
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let init = 0;
  let unbind: (() => void) | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  let volumeWriting: Promise<void> | null = null;
  let pendingVolume: { db: number; refresh: boolean } | null = null;
  // 宿主最近报的曲目原样，与电台报的这一首（`streamTrack.ts`）。
  let tagged: Track | null = null;
  let stream: StreamTrack | null = null;
  // 核对停止的那次读取不走领域代次：紧跟停止的 stateChanged 不该作废它。
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
  // 每个领域一个代次，各防各的过期应答；共用一个的话，1 Hz 的进度事件会不停作废曲目与音量的初读。
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
  const connected = () => !disposed && store.get(stateAtom).status === 'connected';
  const bump = (domain: Domain) => ++generation[domain];

  /** 读一个领域：应答晚于同领域更新的一律丢掉；失败或拿不到应答只记一笔，不动已有状态。 */
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
   * `track` 是宿主报的原样，电台报过的曲名与艺人由这里盖上去。`fresh`：从头开始放的一首，同一首重放也按
   * 换曲处理，进度从 0 起。
   */
  function applyTrack(track: Track | null, fresh = false): void {
    const key = trackKeyOf(track);
    const changed = fresh || key !== trackKeyOf(store.get(stateAtom).track);
    tagged = track;
    if (changed) stream = null;
    if (!track) {
      // 停止与正常的没有曲目都清掉展示、作废在路上的进度；音量与顺序不动。
      bump('position');
      update({ track: null, position: 0, duration: 0 });
      store.set(trackStatusAtom, 'ready');
      return;
    }
    const shown = withStreamTrack(track, stream, key);
    if (!changed) {
      update({ track: shown });
      store.set(trackStatusAtom, 'ready');
      return;
    }
    update({ track: shown, position: 0, duration: track.duration });
    store.set(trackStatusAtom, 'ready');
    void readPosition();
  }

  // 播放状态与能不能 seek 同属一个领域：宿主的 stateChanged 把两项一起带来，应答晚于它就整条作废。
  const readState = () =>
    read(
      'state',
      () => host.player.getState(),
      (answer) => update({ state: answer.state, canSeek: answer.canSeek }),
    );
  // `found: false` 是正常的没有曲目，不是断连；换曲途中新曲目还没打开时也这么答，不拿它清展示。
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

  /** 应答自带曲目身份（路径加 subsong），与当前曲目对不上说明期间换过曲，丢掉。 */
  async function readPosition(): Promise<void> {
    if (!store.get(stateAtom).track) return;
    await read(
      'position',
      () => host.player.getPosition(),
      (answer) => {
        if (trackKeyOf(answer) !== trackKeyOf(store.get(stateAtom).track)) return;
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
    unbind = bindPlaybackEvents(host, {
      // 新曲目能不能 seek 由紧跟着的 stateChanged 带来，不另读。
      trackChanged: (track) => {
        const fresh = transit.arrived();
        bump('track');
        applyTrack(track, fresh);
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
        update({ track: withStreamTrack(tagged, stream, key) });
      },
      starting: () => transit.starting(),
      stopped: (reason) => {
        // 换曲过程中的停止不清展示；这时宿主也不发 stopped 状态。其余的先核对（`stopTransit.ts`）。
        if (reason === 'starting_another') return;
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
        if (transit.phase() === 'steady') {
          bump('position');
          update({ state, position, duration, canSeek });
          return;
        }
        // 核对中的「停止」由核对落定；报了在放就是换曲，只收状态与能不能 seek。
        if (state === 'stopped') return;
        transit.starting();
        update({ state, canSeek });
      },
      positionChanged: (position) => {
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
    // 先订阅再初读，两者之间的变化才不会漏。
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
    seek: (seconds) =>
      command(
        () => host.player.seek(clamp(seconds, 0, store.get(stateAtom).duration)),
        () => void readPosition(),
      ),
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
    retry() {
      if (disposed) return;
      update({ failure: null });
      if (connected()) refreshAll();
      else void start();
    },
    dismissFailure: () => update({ failure: null }),
    dispose() {
      disposed = true;
      pendingVolume = null;
      init += 1;
      transit.dispose();
      unbind?.();
      unbind = undefined;
      waiter?.cancel();
    },
  };
}
