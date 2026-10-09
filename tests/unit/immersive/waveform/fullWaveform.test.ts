import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { atom } from 'jotai/vanilla';
import {
  PENDING_DELAY_MS,
  WAVEFORM_RESOLUTION,
  fullWaveformAtom,
  startFullWaveform,
  type FullWaveformHost,
} from '../../../../src/immersive/waveform/fullWaveform.ts';
import { flush, startPlayingTrack, type PlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 整轨波形的取数用注入的宿主替身测：`FullWaveformHost` 只有 `audio.generateFullWaveform` 一条，签名取自 SDK
 * 的 `fb`。SDK 在缓存没命中时自己等事件，对这里来说就是一个晚些才兑现的 Promise，替身用「悬着」表示。
 * 曲目由真的播放服务给，宿主替身推换曲事件。
 */
type Generate = FullWaveformHost['audio']['generateFullWaveform'];
type Reply = Awaited<ReturnType<Generate>>;
type Mode = 'ready' | 'hold' | 'fail';

const POINTS = [0.2, 0.9, 1, 0.4];
const READY: Reply = { success: true, status: 'ready', waveform: POINTS };
const A = makeTrack({ path: 'file://E:/Music/a.flac' });
const B = makeTrack({ path: 'file://E:/Music/b.flac' });
const C = makeTrack({ path: 'file://E:/Music/c.flac' });

function fakeWaveform() {
  const calls: { path: string; options: Parameters<Generate>[1] }[] = [];
  const pending: { resolve: (reply: Reply) => void; reject: (reason: unknown) => void }[] = [];
  let mode: Mode = 'ready';
  const host: FullWaveformHost = {
    audio: {
      generateFullWaveform: (path, options) => {
        calls.push({ path, options: { ...options } });
        if (mode === 'fail') return Promise.resolve({ success: false, error: 'NOT_FOUND' });
        if (mode === 'hold') {
          return new Promise<Reply>((resolve, reject) => pending.push({ resolve, reject }));
        }
        return Promise.resolve(READY);
      },
    },
  };
  return {
    host,
    calls,
    set: (next: Mode) => {
      mode = next;
    },
    /** 兑现最早那一个悬着的请求。 */
    release: (reply: Reply = READY) => pending.shift()?.resolve(reply),
    /** 让最早那一个悬着的请求 reject：SDK 收到失败事件或等到超时就是这样。 */
    fail: () => pending.shift()?.reject({ success: false, error: 'TIMEOUT' }),
  };
}

function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => void vi.useRealTimers());
}

async function setup(fake = fakeWaveform(), player?: PlayingTrack) {
  const playing = player ?? (await startPlayingTrack());
  const active = atom(true);
  const service = startFullWaveform(playing.store, { host: fake.host, active });
  onTestFinished(() => service.dispose());
  return {
    ...playing,
    fake,
    service,
    state: () => playing.store.get(fullWaveformAtom),
    activate: (value: boolean) => playing.store.set(active, value),
  };
}

describe('startFullWaveform', () => {
  test('缓存命中：换曲问一次 rms、1024 点，路径交 handle 且不带 cueIndex；同一曲不重问；不报 pending', async () => {
    const { fake, play, edit, state } = await setup();
    fakeTimers();
    expect(state()).toStrictEqual({ status: 'idle', rms: [] });
    const cue = makeTrack({ path: 'file://E:/Music/a.cue', subsong: 2 });
    play(cue);
    await flush();
    expect(fake.calls).toStrictEqual([
      {
        path: 'E:/Music/a.cue|subsong:2',
        options: {
          resolution: WAVEFORM_RESOLUTION,
          method: 'rms',
          signal: expect.any(AbortSignal),
        },
      },
    ]);
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    expect(state().status).toBe('ready');
    edit({ ...cue, title: 'edited' });
    play(cue);
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
  });

  test('先订阅再初读：服务起来之前已在播的那一首照问', async () => {
    const player = await startPlayingTrack();
    player.play(A);
    const fake = fakeWaveform();
    const { state } = await setup(fake, player);
    await flush();
    expect(fake.calls.map((call) => call.path)).toStrictEqual([A.handle]);
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
  });

  test('没命中：到点才报 pending，结果到了转 ready', async () => {
    const fake = fakeWaveform();
    fake.set('hold');
    const { play, state } = await setup(fake);
    fakeTimers();
    play(A);
    await flush();
    vi.advanceTimersByTime(PENDING_DELAY_MS - 1);
    expect(state().status).toBe('idle');
    vi.advanceTimersByTime(1);
    expect(state()).toStrictEqual({ status: 'pending', rms: [] });
    fake.release();
    await flush();
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
  });

  test('三条失败路径都落 failed：同步 success: false、失败事件 / 超时（reject）、空点', async () => {
    const fake = fakeWaveform();
    const { play, state } = await setup(fake);
    fakeTimers();
    fake.set('fail');
    play(A);
    await flush();
    expect(state()).toStrictEqual({ status: 'failed', rms: [] });
    fake.set('hold');
    play(B);
    await flush();
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    expect(state().status).toBe('pending');
    fake.fail();
    await flush();
    expect(state()).toStrictEqual({ status: 'failed', rms: [] });
    play(C);
    await flush();
    fake.release({ success: true, status: 'ready', waveform: [] });
    await flush();
    expect(state()).toStrictEqual({ status: 'failed', rms: [] });
  });

  test('晚到的丢：问着上一曲时换曲，旧曲的结果不落地，新曲的才算', async () => {
    const fake = fakeWaveform();
    fake.set('hold');
    const { play, state } = await setup(fake);
    fakeTimers();
    play(A);
    await flush();
    play(B);
    expect(fake.calls[0]?.options?.signal?.aborted).toBe(true);
    await flush();
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    expect(fake.calls.map((call) => call.path)).toStrictEqual([A.handle, B.handle]);
    fake.release({ success: true, status: 'ready', waveform: [0.5] });
    await flush();
    expect(state()).toStrictEqual({ status: 'pending', rms: [] });
    fake.release();
    await flush();
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
  });

  test('闸：宿主没连上、无曲目不问（idle）；网络流不问（failed）；换曲先清掉上一曲的点', async () => {
    const player = await startPlayingTrack({ available: false });
    player.host.answer('playback.getCurrentTrack', { success: true, found: true, track: A });
    const fake = fakeWaveform();
    const { host, playback, play, stop, state } = await setup(fake, player);
    await flush();
    expect(fake.calls).toHaveLength(0);
    expect(state().status).toBe('idle');
    host.connect();
    await playback.ready;
    await flush();
    expect(fake.calls.map((call) => call.path)).toStrictEqual([A.handle]);
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
    play(makeTrack({ path: 'http://stream.example/live', handle: 'http://stream.example/live' }));
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(state()).toStrictEqual({ status: 'failed', rms: [] });
    stop();
    await flush();
    expect(state()).toStrictEqual({ status: 'idle', rms: [] });
  });

  test('释放后悬着的结果丢、pending 计时器不再响', async () => {
    const fake = fakeWaveform();
    fake.set('hold');
    const { play, service, state } = await setup(fake);
    fakeTimers();
    play(A);
    await flush();
    service.dispose();
    expect(fake.calls[0]?.options?.signal?.aborted).toBe(true);
    vi.advanceTimersByTime(PENDING_DELAY_MS);
    fake.release();
    await flush();
    expect(state()).toStrictEqual({ status: 'idle', rms: [] });
    play(B);
    await flush();
    expect(fake.calls).toHaveLength(1);
  });

  test('只问 rms 一次，不再为量表问 peak', async () => {
    const fake = fakeWaveform();
    const { play, state } = await setup(fake);
    play(A);
    await flush();
    expect(
      fake.calls.map((call) => [call.options?.method, call.options?.resolution]),
    ).toStrictEqual([['rms', WAVEFORM_RESOLUTION]]);
    expect(state()).toStrictEqual({ status: 'ready', rms: POINTS });
  });

  test('休眠同步取消生成和 pending 计时；恢复只取当前曲目，取消不记失败', async () => {
    const fake = fakeWaveform();
    fake.set('hold');
    const x = await setup(fake);
    fakeTimers();
    x.play(A);
    x.activate(false);
    expect(fake.calls[0]?.options?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(x.state().status).toBe('idle');
    x.play(B);
    fake.release();
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(x.state().status).toBe('idle');
    x.activate(true);
    expect(fake.calls.map((call) => call.path)).toEqual([A.handle, B.handle]);
    fake.release();
    await flush();
    expect(x.state().status).toBe('ready');
  });

  test.each(['ready', 'fail'] as const)('休眠保留完整结果与失败记忆：%s', async (mode) => {
    const fake = fakeWaveform();
    fake.set(mode);
    const x = await setup(fake);
    x.play(A);
    await flush();
    const last = x.state();
    x.activate(false);
    x.activate(true);
    await flush();
    expect(fake.calls).toHaveLength(1);
    expect(x.state()).toBe(last);
    x.service.dispose();
    expect(x.state()).toEqual({ status: 'idle', rms: [] });
  });

  test('失败后停止再播放同一首，仍按原规则重试', async () => {
    const fake = fakeWaveform();
    fake.set('fail');
    const x = await setup(fake);
    x.play(A);
    await flush();
    x.activate(false);
    x.stop();
    await flush();
    fake.set('ready');
    x.play(A);
    x.activate(true);
    await flush();
    expect(fake.calls).toHaveLength(2);
    expect(x.state()).toEqual({ status: 'ready', rms: POINTS });
  });
});
