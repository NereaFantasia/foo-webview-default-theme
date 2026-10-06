import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { currentTrackAtom, playbackAtom, startPlayback } from '../../../src/playback/playback.ts';
import { HIGH_RES_SILENCE_MS } from '../../../src/playback/playbackEvents.ts';
import { createVolumeSender } from '../../../src/shell/player/volume/volumeControl.ts';
import { amplitudeOf } from '../../../src/playback/volumeScale.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** 等替身在微任务里答完、服务把应答写进状态。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const PLAYBACK_EVENTS = [
  'playback:trackChanged',
  'playback:edited',
  'playback:starting',
  'playback:dynamicInfoTrack',
  'playback:stopped',
  'playback:paused',
  'playback:stateChanged',
  'playback:seeked',
  'playback:timeHighRes',
  'playback:time',
  'playback:volumeChanged',
  'playback:orderChanged',
] as const;

const FEATHER = makeTrack();
const LUV = makeTrack({
  path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac',
  title: 'Luv (sic) Part 3',
});

const STOPPED = { success: true, state: 'stopped', canSeek: false, canPause: false } as const;
const PLAYING = { success: true, state: 'playing', canSeek: true, canPause: true } as const;

function playing(host: UnitHost): void {
  host.answer('playback.getState', {
    success: true,
    state: 'playing',
    canSeek: true,
    canPause: true,
  });
  host.answer('playback.getCurrentTrack', { success: true, found: true, track: FEATHER });
  host.answer('playback.getPosition', {
    hostTime: Date.now(),
    success: true,
    position: 42,
    duration: FEATHER.duration,
    subsong: 0,
    path: FEATHER.path,
  });
}

async function start(host: UnitHost) {
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  await playback.ready;
  await settle();
  return { store, playback, state: () => store.get(playbackAtom) };
}

describe('startPlayback', () => {
  it.each(['seek', 'highRes', 'state'] as const)(
    '%s 事件使同曲目的旧进度读取作废',
    async (event) => {
      const host = installFakeHost();
      playing(host);
      const held = host.hold('playback.getPosition');
      const { state, playback } = await start(host);
      try {
        expect(held.pending).toHaveLength(1);
        if (event === 'seek') host.emit('playback:seeked', { hostTime: Date.now(), position: 100 });
        else if (event === 'highRes')
          host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 100 });
        else
          host.emit('playback:stateChanged', {
            hostTime: Date.now(),
            state: 'playing',
            canSeek: true,
            position: 100,
            duration: FEATHER.duration,
          });
        expect(state().position).toBe(100);
        held.release();
        await settle();
        expect(state().position).toBe(100);
      } finally {
        playback.dispose();
      }
    },
  );

  it('先订阅再初读：初读发出时播放事件都已订上', async () => {
    const host = installFakeHost();
    const subscribedAtRead: number[] = [];
    host.answer('playback.getCurrentTrack', () => {
      subscribedAtRead.push(host.listenerCount('playback:trackChanged'));
      return { success: true, found: false };
    });
    const { state } = await start(host);
    expect(subscribedAtRead).toEqual([1]);
    expect(PLAYBACK_EVENTS.map((event) => host.listenerCount(event))).toEqual(
      PLAYBACK_EVENTS.map(() => 1),
    );
    expect(state()).toMatchObject({
      status: 'connected',
      track: null,
      order: 'default',
      volumeDb: 0,
    });
  });

  it('初读到正在放的曲目：记下曲目，再按曲目读进度', async () => {
    const host = installFakeHost();
    playing(host);
    const { state } = await start(host);
    expect(state()).toMatchObject({ state: 'playing', canSeek: true, position: 42, duration: 175 });
    expect(state().track?.title).toBe('Feather');
  });

  it('各领域的代次互不作废：进度事件不作废曲目初读，晚到的旧状态应答让位给事件', async () => {
    const host = installFakeHost();
    playing(host);
    const track = host.hold('playback.getCurrentTrack');
    const transport = host.hold('playback.getState');
    const { state } = await start(host);

    host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 3.2 });
    host.emit('playback:paused', { paused: true });
    track.release();
    transport.release();
    await settle();
    expect(state().track?.title).toBe('Feather');
    // 初读的 getState 答 playing，但它晚于暂停事件，丢掉。
    expect(state().state).toBe('paused');
  });

  it('进度应答对不上当前曲目就丢掉', async () => {
    const host = installFakeHost();
    playing(host);
    host.answer('playback.getPosition', {
      hostTime: Date.now(),
      success: true,
      position: 99,
      duration: 300,
      subsong: 0,
      path: LUV.path,
    });
    const { state } = await start(host);
    expect(state()).toMatchObject({ position: 0, duration: 175 });
  });

  it(`进度以高频事件为准，静默 ${HIGH_RES_SILENCE_MS} ms 后才让 1 Hz 的事件顶上`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const host = installFakeHost();
    playing(host);
    const { state } = await start(host);

    host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 10.4 });
    host.emit('playback:time', { position: 10 });
    expect(state().position).toBe(10.4);
    vi.setSystemTime(Date.now() + HIGH_RES_SILENCE_MS + 1);
    host.emit('playback:time', { position: 12 });
    expect(state().position).toBe(12);
  });

  it('换曲过程中的停止不清展示；用户停止先核对，宿主答停着才清', async () => {
    const host = installFakeHost();
    playing(host);
    const { state } = await start(host);
    host.emit('playback:stopped', { reason: 'starting_another' });
    expect(state().track?.title).toBe('Feather');

    host.answer('playback.getState', STOPPED);
    const reads = host.callsTo('playback.getState').length;
    host.emit('playback:stopped', { reason: 'user' });
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'stopped',
      position: 0,
      duration: 0,
      canSeek: false,
    });
    expect(state()).toMatchObject({ state: 'playing', canSeek: true });
    expect(state().track?.title).toBe('Feather');
    await settle();
    expect(host.callsTo('playback.getState')).toHaveLength(reads + 1);
    expect(state()).toMatchObject({
      state: 'stopped',
      canSeek: false,
      track: null,
      position: 0,
      duration: 0,
    });
  });

  it('用户停止后紧跟 starting 是在换曲：旧曲目留到新曲目到，中间不闪成没有曲目', async () => {
    const host = installFakeHost();
    playing(host);
    const { store, state } = await start(host);
    const seen: (string | null)[] = [];
    const off = store.sub(currentTrackAtom, () => {
      seen.push(store.get(currentTrackAtom)?.title ?? null);
    });

    // 专辑起播：宿主对另一行 playTrack，先报用户停止，再报 starting 与还没打开的新曲目的状态。
    host.emit('playback:stopped', { reason: 'user' });
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'stopped',
      position: 0,
      duration: 0,
      canSeek: false,
    });
    host.emit('playback:starting', { command: 'play', paused: false });
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'playing',
      position: 0,
      duration: 0,
      canSeek: false,
    });
    host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 0 });
    await settle();
    expect(state()).toMatchObject({ state: 'playing', position: 42, duration: 175 });
    expect(state().track?.title).toBe('Feather');

    host.emit('playback:trackChanged', LUV);
    expect(state()).toMatchObject({ position: 0, duration: LUV.duration });
    off();
    expect(seen).toEqual(['Luv (sic) Part 3']);
  });

  it('停止之后同一首从头再放：按换曲处理，进度从 0 起', async () => {
    const host = installFakeHost();
    playing(host);
    const { state } = await start(host);
    expect(state().position).toBe(42);
    host.emit('playback:stopped', { reason: 'user' });
    host.emit('playback:starting', { command: 'play', paused: false });
    host.answer('playback.getPosition', {
      hostTime: Date.now(),
      success: true,
      position: 0.1,
      duration: FEATHER.duration,
      subsong: 0,
      path: FEATHER.path,
    });
    host.emit('playback:trackChanged', FEATHER);
    expect(state().position).toBe(0);
    await settle();
    expect(state().position).toBe(0.1);
  });

  it('核对问不到宿主也照停止处理', async () => {
    const host = installFakeHost();
    playing(host);
    const { state } = await start(host);
    host.answer('playback.getState', hostFailure('INTERNAL_ERROR'));
    host.emit('playback:stopped', { reason: 'eof' });
    await settle();
    expect(state()).toMatchObject({ state: 'stopped', track: null });
  });

  it('电台报的曲名与艺人盖在标签上；只报曲名时艺人用标签的；换了一首就作废', async () => {
    const host = installFakeHost();
    const station = makeTrack({
      path: 'https://radio.example/stream',
      title: 'Station',
      artist: 'Radio',
      artists: ['Radio'],
    });
    host.answer('playback.getCurrentTrack', { success: true, found: true, track: station });
    const { state } = await start(host);

    host.emit('playback:dynamicInfoTrack', { title: 'Song A', artist: 'Band A' });
    expect(state().track).toMatchObject({ title: 'Song A', artist: 'Band A', artists: ['Band A'] });
    host.emit('playback:dynamicInfoTrack', { title: 'Song B' });
    expect(state().track).toMatchObject({ title: 'Song B', artist: 'Radio', artists: ['Radio'] });
    // 同一路流被编辑或回读时，报过的这一首照样盖着。
    host.emit('playback:edited', { ...station, genre: 'Jazz' });
    expect(state().track).toMatchObject({ title: 'Song B', genre: 'Jazz' });

    host.emit('playback:trackChanged', LUV);
    expect(state().track?.title).toBe('Luv (sic) Part 3');
    host.emit('playback:trackChanged', station);
    expect(state().track?.title).toBe('Station');
  });

  it('能不能 seek 跟着 stateChanged 走：换曲后紧跟的状态事件带新曲目的值，不另读 getState', async () => {
    const host = installFakeHost();
    playing(host);
    const { store, state } = await start(host);
    expect(state().canSeek).toBe(true);
    const reads = host.callsTo('playback.getState').length;

    // 宿主换曲时先发 trackChanged，紧跟一条带新曲目 canSeek 的 stateChanged。
    host.emit('playback:trackChanged', LUV);
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'playing',
      position: 0,
      duration: 300,
      canSeek: false,
    });
    expect(state()).toMatchObject({ state: 'playing', canSeek: false });
    await settle();
    expect(state()).toMatchObject({ state: 'playing', canSeek: false });
    expect(store.get(currentTrackAtom)?.title).toBe('Luv (sic) Part 3');
    expect(host.callsTo('playback.getState')).toHaveLength(reads);
  });

  it('用户停止后不能 seek；停止前发出的读取晚到，也不把 canSeek 改回来', async () => {
    const host = installFakeHost();
    playing(host);
    const { playback, state } = await start(host);
    expect(state().canSeek).toBe(true);

    const transport = host.hold('playback.getState');
    playback.retry();
    host.emit('playback:stopped', { reason: 'user' });
    // 第二个在等的是核对停止的那次：它先答停着；停止前发出的那次后到，还答着在放。
    expect(transport.pending).toHaveLength(2);
    transport.respond(1, STOPPED);
    await settle();
    expect(state()).toMatchObject({ state: 'stopped', canSeek: false, track: null });
    transport.respond(0, PLAYING);
    transport.release();
    await settle();
    expect(state()).toMatchObject({ state: 'stopped', canSeek: false });
  });

  it('编辑只在是同一首时才刷新', async () => {
    const host = installFakeHost();
    playing(host);
    const { state } = await start(host);
    host.emit('playback:trackChanged', LUV);
    await settle();

    host.emit('playback:edited', { ...FEATHER, title: 'Feather (edit)' });
    expect(state().track?.title).toBe('Luv (sic) Part 3');
    host.emit('playback:edited', { ...LUV, title: 'Luv (sic) Pt. 3' });
    expect(state().track?.title).toBe('Luv (sic) Pt. 3');
  });

  it('顺序事件只带编号，名字要重读', async () => {
    const host = installFakeHost();
    const { state } = await start(host);
    host.answer('playback.getPlaybackOrder', {
      success: true,
      order: 4,
      orderIndex: 4,
      orderName: 'shuffle-tracks',
      name: 'shuffle-tracks',
    });
    host.emit('playback:orderChanged', { order: 4, orderIndex: 4 });
    await settle();
    expect(state().order).toBe('shuffle-tracks');
  });

  it('音量事件直接写，不回读；读失败只记一笔，已有状态不动', async () => {
    const host = installFakeHost();
    const { playback, state } = await start(host);
    const volumeReads = host.callsTo('playback.getVolume').length;
    host.emit('playback:volumeChanged', { volume: 50, volumeDb: -6, muted: false, isMuted: false });
    expect(state()).toMatchObject({ volume: 50, volumeDb: -6 });
    expect(host.callsTo('playback.getVolume').length).toBe(volumeReads);

    host.answer('playback.getVolume', hostFailure('INTERNAL_ERROR'));
    await playback.toggleMute();
    await settle();
    expect(state()).toMatchObject({ failure: 'read', volume: 50, volumeDb: -6 });
  });

  it('命令不做乐观更新：执行后按领域回读；音量按幅度百分比发，实时提交不回读', async () => {
    const host = installFakeHost();
    const { playback, state } = await start(host);
    const trackReads = host.callsTo('playback.getCurrentTrack').length;
    await playback.playOrPause();
    expect(host.callsTo('playback.playOrPause')).toEqual([{}]);
    expect(state().state).toBe('stopped');
    expect(host.callsTo('playback.getCurrentTrack').length).toBe(trackReads + 1);

    const volumeReads = host.callsTo('playback.getVolume').length;
    await playback.setVolume(-20, false);
    expect(host.callsTo('playback.setVolume')).toEqual([{ volume: 10 }]);
    expect(host.callsTo('playback.getVolume').length).toBe(volumeReads);

    host.answer('playback.next', hostFailure('NO_ACTIVE_ITEM'));
    await playback.next();
    expect(state().failure).toBe('command');
  });

  it('音量服务只发在途值与最后待发值，松手后的回读只在写完后进行', async () => {
    const host = installFakeHost();
    const { playback } = await start(host);
    const reads = host.callsTo('playback.getVolume').length;
    const held = host.hold('playback.setVolume');
    const first = playback.setVolume(-30, false);
    void playback.setVolume(-25, false);
    void playback.setVolume(-20, false);
    const last = playback.setVolume(-18);
    expect(host.callsTo('playback.setVolume')).toEqual([{ volume: amplitudeOf(-30) }]);
    held.respond(0);
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    expect(host.callsTo('playback.setVolume')).toEqual([
      { volume: amplitudeOf(-30) },
      { volume: amplitudeOf(-18) },
    ]);
    expect(host.callsTo('playback.getVolume')).toHaveLength(reads);
    held.respond(0);
    await Promise.all([first, last]);
    expect(host.callsTo('playback.getVolume')).toHaveLength(reads + 1);
    playback.dispose();
  });

  it.each([false, true])('实时提交不会丢掉回读请求，回读请求已发出：%s', async (sent) => {
    const host = installFakeHost();
    const { playback } = await start(host);
    const reads = host.callsTo('playback.getVolume').length;
    const held = host.hold('playback.setVolume');
    void playback.setVolume(-30, sent);
    if (!sent) void playback.setVolume(-18);
    const done = playback.setVolume(-17, false);
    held.release();
    await done;
    expect(host.callsTo('playback.setVolume').at(-1)).toEqual({ volume: amplitudeOf(-17) });
    expect(host.callsTo('playback.getVolume')).toHaveLength(reads + 1);
    playback.dispose();
  });

  it('重建音量控件后，新控件目标覆盖旧控件待发值，直接服务调用也共用队列', async () => {
    const host = installFakeHost();
    const { playback } = await start(host);
    const held = host.hold('playback.setVolume');
    const old = createVolumeSender(playback);
    old.live(-30);
    old.commit(-20);
    const current = createVolumeSender(playback);
    current.commit(-10);
    const done = playback.setVolume(-8, false);
    expect(host.callsTo('playback.setVolume')).toHaveLength(1);
    held.release();
    await done;
    expect(host.callsTo('playback.setVolume')).toEqual([
      { volume: amplitudeOf(-30) },
      { volume: amplitudeOf(-8) },
    ]);
    playback.dispose();
  });

  it('音量写入失败后仍发送最新目标，错误照常报告', async () => {
    const host = installFakeHost();
    const { playback, state } = await start(host);
    const held = host.hold('playback.setVolume');
    void playback.setVolume(-30, false);
    const done = playback.setVolume(-10);
    held.respond(0, hostFailure('INTERNAL_ERROR'));
    await vi.waitFor(() => expect(held.pending).toHaveLength(1));
    held.respond(0);
    await done;
    expect(state().failure).toBe('command');
    expect(host.callsTo('playback.setVolume').at(-1)).toEqual({ volume: amplitudeOf(-10) });
    playback.dispose();
  });

  it('释放播放服务取消待发音量与回读，已发出的应答不再改状态', async () => {
    const host = installFakeHost();
    const { playback, state } = await start(host);
    const held = host.hold('playback.setVolume');
    const reads = host.callsTo('playback.getVolume').length;
    void playback.setVolume(-30);
    const done = playback.setVolume(-10);
    playback.dispose();
    const before = state();
    held.release();
    await done;
    await playback.setVolume(-5);
    expect(host.callsTo('playback.setVolume')).toHaveLength(1);
    expect(host.callsTo('playback.getVolume')).toHaveLength(reads);
    expect(state()).toBe(before);
  });

  it('重试时先摘掉旧订阅：连接中、未连接、已连接时重试，每个事件都只订一份', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const playback = startPlayback(store, host.fb);
    playback.retry();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(store.get(playbackAtom).status).toBe('disconnected');

    host.connect();
    playback.retry();
    await vi.advanceTimersByTimeAsync(0);
    playback.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get(playbackAtom).status).toBe('connected');
    expect(PLAYBACK_EVENTS.map((event) => host.listenerCount(event))).toEqual(
      PLAYBACK_EVENTS.map(() => 1),
    );
    const orderReads = host.callsTo('playback.getPlaybackOrder').length;
    host.emit('playback:orderChanged', { order: 1, orderIndex: 1 });
    expect(host.callsTo('playback.getPlaybackOrder').length).toBe(orderReads + 1);
  });

  it('释放后播放事件都摘干净，晚到的应答不再写状态', async () => {
    const host = installFakeHost();
    playing(host);
    const track = host.hold('playback.getCurrentTrack');
    const { playback, state } = await start(host);
    playback.dispose();
    expect(PLAYBACK_EVENTS.map((event) => host.listenerCount(event))).toEqual(
      PLAYBACK_EVENTS.map(() => 0),
    );
    track.release();
    await settle();
    expect(state().track).toBeNull();
  });

  it('等不到宿主时停在未连接，命令一条也不发', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const playback = startPlayback(store, host.fb);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await playback.ready;
    expect(store.get(playbackAtom).status).toBe('disconnected');
    await playback.playOrPause();
    expect(host.calls).toEqual([]);
  });
});
