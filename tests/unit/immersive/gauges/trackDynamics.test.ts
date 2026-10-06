import { describe, expect, test } from 'vitest';
import { PcmUnavailableError } from '../../../../src/immersive/analysis/trackAnalysis.ts';
import {
  measureTrack,
  segmentSeconds,
  startTrackDynamics,
  trackDynamicsAtom,
  type DynamicsTrack,
  type PcmPlanes,
  type PlanesSource,
} from '../../../../src/immersive/gauges/trackDynamics.ts';
import { flush, startPlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 整轨读数用假的 PCM 来源测：来源按区间现造 48 kHz 立体声 1 kHz 正弦（峰值 −23 dBFS，响度正好 −23 LUFS），
 * 记下每次要的区间、中止信号与释放次数。让出主线程换成立即兑现的 Promise。曲目由真的播放服务给。
 */
const RATE = 48000;
const LEVEL = 10 ** (-23 / 20);
const now = (): Promise<void> => Promise.resolve();

function fakeSource(options: { rate?: (start: number) => number; hold?: boolean } = {}) {
  const ranges: [number, number][] = [];
  const signals: AbortSignal[] = [];
  let released = 0;
  const held: (() => void)[] = [];
  const source: PlanesSource = async (_track, range, signal) => {
    ranges.push([range.start, range.end]);
    signals.push(signal);
    if (options.hold) await new Promise<void>((resolve) => held.push(resolve));
    const sampleRate = options.rate?.(range.start) ?? RATE;
    const frames = Math.round((range.end - range.start) * sampleRate);
    const plane = new Float32Array(frames);
    const first = Math.round(range.start * sampleRate);
    for (let index = 0; index < frames; index += 1) {
      plane[index] = LEVEL * Math.sin((2 * Math.PI * 1000 * (first + index)) / sampleRate);
    }
    const piece: PcmPlanes = {
      sampleRate,
      frames,
      planes: [plane, plane],
      release: () => {
        released += 1;
      },
    };
    return piece;
  };
  return {
    source,
    ranges,
    signals,
    released: () => released,
    release: () => held.shift()?.(),
  };
}

const TRACK: DynamicsTrack = {
  path: 'file://E:/Music/a.flac',
  handle: 'E:/Music/a.flac',
  duration: 70,
  sampleRate: RATE,
  channels: 2,
};

describe('measureTrack', () => {
  test('段长：3 s 的整数倍、不超过 30 s、一段不超过 16 MiB；报未知时取上限', () => {
    expect(segmentSeconds(44100, 2)).toBe(30);
    expect(segmentSeconds(48000, 2)).toBe(30);
    expect(segmentSeconds(192000, 2)).toBe(9);
    expect(segmentSeconds()).toBe(30);
    expect(segmentSeconds(0, 0)).toBe(30);
  });

  test('按段读完整首：区间对齐 3 s 的块，每段都释放；正弦是 DR0、Integrated −23', async () => {
    const fake = fakeSource();
    const result = await measureTrack(
      TRACK,
      fake.source,
      new AbortController().signal,
      () => true,
      now,
    );
    expect(fake.ranges).toStrictEqual([
      [0, 30],
      [30, 60],
      [60, 70],
    ]);
    expect(fake.released()).toBe(3);
    expect(result?.dynamicRange).toBe(0);
    expect(result?.integrated).not.toBeNull();
    expect(result?.integrated).toBeCloseTo(-23, 1);
  });

  test('中途不再是当前曲目：停下给 null，手上那段照样释放', async () => {
    const fake = fakeSource();
    let calls = 0;
    const result = await measureTrack(
      TRACK,
      fake.source,
      new AbortController().signal,
      () => {
        calls += 1;
        return calls < 3;
      },
      now,
    );
    expect(result).toBeNull();
    expect(fake.released()).toBe(fake.ranges.length);
  });

  test('段与段之间采样率变了、没有时长、这首取不了：都给 null', async () => {
    const changing = fakeSource({ rate: (start) => (start === 0 ? RATE : 44100) });
    const signal = new AbortController().signal;
    expect(await measureTrack(TRACK, changing.source, signal, () => true, now)).toBeNull();
    expect(changing.released()).toBe(2);
    const untimed: DynamicsTrack = { path: 'x', handle: 'x' };
    expect(await measureTrack(untimed, changing.source, signal, () => true, now)).toBeNull();
    const none: PlanesSource = async () => null;
    expect(await measureTrack(TRACK, none, signal, () => true, now)).toBeNull();
  });
});

const A = makeTrack({ path: 'file://E:/Music/a.flac', duration: 70, sampleRate: RATE });
const B = makeTrack({ path: 'file://E:/Music/b.flac', duration: 10, sampleRate: RATE });

async function setup(source: PlanesSource | null) {
  const player = await startPlayingTrack();
  player.play(A);
  const service = startTrackDynamics(player.store, { source, pause: now });
  return { ...player, service, model: () => player.store.get(trackDynamicsAtom) };
}

describe('startTrackDynamics', () => {
  test('换曲中止在途的那首；同一首切回来不重算', async () => {
    const fake = fakeSource({ hold: true });
    const { play, stop, model } = await setup(fake.source);
    await flush();
    expect(model().status).toBe('loading');
    play(B);
    await flush();
    expect(fake.signals.map((signal) => signal.aborted)).toStrictEqual([true, false]);
    fake.release();
    await flush();
    fake.release();
    await flush();
    expect(model().status).toBe('ready');
    expect(model().result?.dynamicRange).toBe(0);
    expect(fake.released(), '中止的那首拿到的段也释放').toBe(2);
    const asked = fake.ranges.length;
    stop();
    await flush();
    expect(model()).toStrictEqual({ status: 'idle', result: null });
    play(B);
    await flush();
    expect(fake.ranges).toHaveLength(asked);
    expect(model().status).toBe('ready');
  });

  test('宿主没连上不取；连上后按当时的曲目取', async () => {
    const fake = fakeSource();
    const player = await startPlayingTrack({ available: false });
    player.host.answer('playback.getCurrentTrack', { success: true, found: true, track: B });
    startTrackDynamics(player.store, { source: fake.source, pause: now });
    await flush();
    expect(fake.ranges).toStrictEqual([]);
    expect(player.store.get(trackDynamicsAtom).status).toBe('idle');
    player.host.connect();
    await player.playback.ready;
    await flush();
    expect(fake.ranges).toStrictEqual([[0, 10]]);
    expect(player.store.get(trackDynamicsAtom).status).toBe('ready');
  });

  test('页面取不了 PCM 之后不再试', async () => {
    let asked = 0;
    const { play, model } = await setup(async () => {
      asked += 1;
      throw new PcmUnavailableError();
    });
    await flush();
    expect(model()).toStrictEqual({ status: 'unavailable', result: null });
    play(B);
    await flush();
    expect(model().status).toBe('unavailable');
    expect(asked).toBe(1);
  });

  test('没有来源是 unavailable', async () => {
    const { model } = await setup(null);
    expect(model()).toStrictEqual({ status: 'unavailable', result: null });
  });

  test('释放：中止在途的解码，结果丢掉', async () => {
    const fake = fakeSource({ hold: true });
    const { service, model } = await setup(fake.source);
    await flush();
    service.dispose();
    expect(fake.signals.map((signal) => signal.aborted)).toStrictEqual([true]);
    fake.release();
    await flush();
    expect(fake.released()).toBe(1);
    expect(model()).toStrictEqual({ status: 'loading', result: null });
  });
});
