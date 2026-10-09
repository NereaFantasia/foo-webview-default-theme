import type { Track } from 'foo-webview-sdk';
import { atom } from 'jotai/vanilla';
import type {
  PcmRingRead,
  PcmSegment,
  PcmStreamFormat,
  PcmStreamOptions,
  PcmStreamOutcome,
} from 'foo-webview-sdk/bridge';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  READ_FPS,
  STREAM_BUFFER_SECONDS,
  STREAM_INTERVAL_SECONDS,
  liveLoudnessAtom,
  startLiveLoudness,
  type LiveLoudnessHost,
  type LiveStream,
} from '../../../../src/immersive/gauges/liveLoudness.ts';
import { fakeFrames } from '../../../fixtures/fakeFrames.ts';
import { flush, startPlayingTrack, type PlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 实时响度用手动帧时钟与手写的流替身测：每次 `subscribeStream` 造一条替身流，用例往它的 `reads` 里排下几次
 * `read()` 要答的帧，`ready` 按用例给的结果答或悬着；`step()` 走一拍（50 ms，正好是读流的频率上限）。
 * 曲目、暂停与停止由真的播放服务给。信号是 1 kHz 正弦，立体声下峰值多少 dBFS 响度就是多少 LUFS（BS.1770 的定标）。
 */
const RATE = 48000;
const STEP_MS = 1000 / READ_FPS;
const OK: PcmStreamOutcome = { ok: true, subscriptionId: 'pcmstream_1' };
const REFUSED: PcmStreamOutcome = { ok: false, code: 'NOT_SUPPORTED' };
const STEREO_48K: PcmStreamFormat = {
  sampleRate: RATE,
  channels: 2,
  capacityFrames: RATE,
  epoch: 1,
};
const EMPTY = { momentary: null, shortTerm: null, failed: false };
const A = makeTrack({ path: 'file://E:/Music/a.flac' });
const B = makeTrack({ path: 'file://E:/Music/b.flac' });

function sine(seconds: number, dbfs: number, rate = RATE): Float32Array {
  const amplitude = 10 ** (dbfs / 20);
  const out = new Float32Array(Math.round(rate * seconds));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / rate);
  }
  return out;
}

const segment = (offset: number, id: number | null): PcmSegment => ({
  offset,
  segment: id,
  startSeconds: null,
  reason: null,
  estimated: false,
});

/** 一次读数：每路同一段信号，段表按 `segments` 给（缺省整段都在段 1）。 */
function readOf(
  signal: Float32Array,
  segments = [segment(0, 1)],
  dropped = 0,
  channels = 2,
): PcmRingRead {
  const planes = Array.from({ length: channels }, () => signal);
  return { planes, frames: signal.length, dropped, hostTimeMs: 0, segments };
}

interface FakeStream {
  readonly options: PcmStreamOptions;
  /** 下几次 `read()` 要答的帧，先进先出；排空了答 null，即暂停或还没来帧。 */
  readonly reads: PcmRingRead[];
  format: PcmStreamFormat | null;
  unsubscribed: number;
  /** 兑现这条流的 `ready`。 */
  answer(outcome: PcmStreamOutcome): void;
}

/** 新订阅的 `ready` 按 `outcome` 当场答；`outcome` 为 null 时悬着，由用例 `answer`。 */
function fakeStreams(outcome: PcmStreamOutcome | null) {
  const streams: FakeStream[] = [];
  const fake = {
    outcome,
    streams,
    nth(index: number): FakeStream {
      const found = streams[index];
      if (!found) throw new Error(`没有第 ${index + 1} 次订阅`);
      return found;
    },
    host: {
      audio: {
        subscribeStream(options) {
          let resolve: (answer: PcmStreamOutcome) => void = () => {};
          const ready = new Promise<PcmStreamOutcome>((done) => {
            resolve = done;
          });
          const record: FakeStream = {
            options: { ...options },
            reads: [],
            format: STEREO_48K,
            unsubscribed: 0,
            answer: (answer) => resolve(answer),
          };
          streams.push(record);
          if (fake.outcome) record.answer(fake.outcome);
          const stream: LiveStream = {
            ready,
            get format() {
              return record.format;
            },
            read: () => record.reads.shift() ?? null,
            unsubscribe: () => {
              record.unsubscribed += 1;
            },
          };
          return stream;
        },
      },
    } satisfies LiveLoudnessHost,
  };
  return fake;
}

async function setup(
  options: {
    outcome?: PcmStreamOutcome | null;
    player?: PlayingTrack;
    first?: Track | null;
    active?: boolean;
  } = {},
) {
  const player = options.player ?? (await startPlayingTrack());
  const first = options.first === undefined ? A : options.first;
  if (first) player.play(first);
  const fake = fakeStreams(options.outcome === undefined ? OK : options.outcome);
  const frames = fakeFrames();
  const active = atom(options.active ?? true);
  const service = startLiveLoudness(player.store, { host: fake.host, clock: frames.clock, active });
  onTestFinished(() => service.dispose());
  await flush();
  return {
    ...player,
    fake,
    frames,
    service,
    state: () => player.store.get(liveLoudnessAtom),
    step: () => frames.step(STEP_MS),
    activate: (value: boolean) => player.store.set(active, value),
  };
}

/** 读数落在 `expected ± tolerance`（LUFS）里。 */
function expectNear(actual: number | null, expected: number, tolerance: number, label: string) {
  expect(actual, `${label}：没有值`).not.toBeNull();
  expect(actual, label).toBeGreaterThanOrEqual(expected - tolerance);
  expect(actual, label).toBeLessThanOrEqual(expected + tolerance);
}

/** 几块 100 ms 块按能量平均后的响度：`[块数, LUFS]`。 */
const mixed = (...parts: [number, number][]): number => {
  const blocks = parts.reduce((sum, [count]) => sum + count, 0);
  const energy = parts.reduce((sum, [count, lufs]) => sum + count * 10 ** (lufs / 10), 0);
  return 10 * Math.log10(energy / blocks);
};

describe('startLiveLoudness', () => {
  test('有曲目就订阅，间隔与缓冲照常量；读到 3 s 的 −23 dBFS 正弦，M 与 S 都是 −23', async () => {
    const { fake, step, state } = await setup();
    expect(fake.streams.map((stream) => stream.options)).toStrictEqual([
      { interval: STREAM_INTERVAL_SECONDS, bufferSeconds: STREAM_BUFFER_SECONDS },
    ]);
    expect(state()).toStrictEqual(EMPTY);
    fake.nth(0).reads.push(readOf(sine(3, -23)));
    await step();
    expectNear(state().momentary, -23, 0.1, 'Momentary');
    expectNear(state().shortTerm, -23, 0.1, 'Short-term');
    expect(state().failed).toBe(false);
  });

  test('先订阅再初读：起来时没有曲目不订阅，宿主报了曲目才订阅；换曲不重订', async () => {
    const { fake, frames, play, step, state } = await setup({ first: null });
    expect(fake.streams).toHaveLength(0);
    expect(frames.pending()).toBe(0);
    play(A);
    await flush();
    expect(fake.streams).toHaveLength(1);
    fake.nth(0).reads.push(readOf(sine(1, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.2, '有曲目之后');
    play(B);
    await flush();
    expect(fake.streams).toHaveLength(1);
    expect(fake.nth(0).unsubscribed).toBe(0);
    expectNear(state().shortTerm, -20, 0.2, '换曲本身不动读数，清不清窗看段表');
  });

  test('宿主没连上不订阅；连上后按当时的曲目订阅', async () => {
    const player = await startPlayingTrack({ available: false });
    player.host.answer('playback.getCurrentTrack', { success: true, found: true, track: A });
    const { fake, host, playback, step, state } = await setup({ player, first: null });
    expect(fake.streams).toHaveLength(0);
    expect(state()).toStrictEqual(EMPTY);
    host.connect();
    await playback.ready;
    await flush();
    expect(fake.streams).toHaveLength(1);
    fake.nth(0).reads.push(readOf(sine(1, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.2, '连上之后');
  });

  test('段号变了从那一帧起清窗：新段第一块出来之前读数不动，之后只算新段', async () => {
    const { fake, step, state } = await setup();
    const stream = fake.nth(0);
    stream.reads.push(readOf(sine(3, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.1, 'seek 前');
    const before = state();
    // seek：新段的头 50 ms 不够一块，读数一次都不写。
    stream.reads.push(readOf(sine(0.05, -30), [segment(0, 2)]));
    await step();
    expect(state()).toBe(before);
    stream.reads.push(readOf(sine(1, -30), [segment(0, 2)]));
    await step();
    expectNear(state().shortTerm, -30, 0.2, '新段');
    expectNear(state().momentary, -30, 0.2, '新段的 Momentary');
  });

  test('同一次读数里跨段：前半截算旧段，段界之后另起', async () => {
    const { fake, step, state } = await setup();
    const old = sine(1, -20);
    const fresh = sine(1, -35);
    const both = new Float32Array(old.length + fresh.length);
    both.set(old);
    both.set(fresh, old.length);
    fake.nth(0).reads.push(readOf(both, [segment(0, 1), segment(old.length, 2)]));
    await step();
    expectNear(state().shortTerm, -35, 0.2, '只剩新段');
    expectNear(state().momentary, -35, 0.2, '只剩新段的 Momentary');
  });

  test('丢帧也清窗：同一段里报了丢帧，之后只算丢帧之后的', async () => {
    const { fake, step, state } = await setup();
    const stream = fake.nth(0);
    stream.reads.push(readOf(sine(3, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.1, '丢帧之前');
    stream.reads.push(readOf(sine(1, -32), [segment(0, 1)], 4800));
    await step();
    expectNear(state().shortTerm, -32, 0.2, '丢帧之后');
  });

  test('暂停：流里不来新帧时读数定格、订阅留着；继续播放是同一段，接着算', async () => {
    const { host, fake, step, state } = await setup();
    const stream = fake.nth(0);
    stream.reads.push(readOf(sine(3, -20)));
    await step();
    const held = state();
    host.emit('playback:paused', { paused: true });
    for (let index = 0; index < 5; index += 1) await step();
    expect(state()).toBe(held);
    expect(fake.streams).toHaveLength(1);
    expect(stream.unsubscribed).toBe(0);
    host.emit('playback:paused', { paused: false });
    stream.reads.push(readOf(sine(1, -32)));
    await step();
    // 不清窗：Short-term 是最近 20 块 −20 与 10 块 −32 的能量平均，Momentary 只剩 −32。
    expectNear(state().shortTerm, mixed([20, -20], [10, -32]), 0.2, '继续之后的 Short-term');
    expectNear(state().momentary, -32, 0.2, '继续之后的 Momentary');
  });

  test('格式变了（采样率或声道数）：换一套 K 加权、清窗，新格式第一块出来之前读数不动', async () => {
    const { fake, step, state } = await setup();
    const stream = fake.nth(0);
    stream.reads.push(readOf(sine(3, -20)));
    await step();
    const before = state();
    // 段号跨格式变化不变，清窗靠的是格式本身。
    stream.format = { sampleRate: 44100, channels: 2, capacityFrames: 44100, epoch: 2 };
    stream.reads.push(readOf(sine(0.05, -30, 44100)));
    await step();
    expect(state()).toBe(before);
    stream.reads.push(readOf(sine(1, -30, 44100)));
    await step();
    expectNear(state().shortTerm, -30, 0.2, '44.1 kHz');
    // 单声道按一路算，同样的样本比立体声低 3 dB。
    stream.format = { sampleRate: 44100, channels: 1, capacityFrames: 44100, epoch: 3 };
    stream.reads.push(readOf(sine(1, -30, 44100), [segment(0, 1)], 0, 1));
    await step();
    expectNear(state().shortTerm, -30 - 10 * Math.log10(2), 0.2, '单声道');
  });

  test('一拍里出了几块，读数只在这一拍末写一次；没出块的拍不写', async () => {
    const { store, fake, step } = await setup();
    let writes = 0;
    const off = store.sub(liveLoudnessAtom, () => {
      writes += 1;
    });
    fake.nth(0).reads.push(readOf(sine(3, -23)));
    await step();
    expect(writes).toBe(1);
    await step();
    expect(writes).toBe(1);
    off();
  });

  test('停止就退订、读数清空、不再读流；再有曲目时重新订阅，读数从头算', async () => {
    const { fake, frames, play, stop, step, state } = await setup();
    fake.nth(0).reads.push(readOf(sine(1, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.2, '停止前');
    stop();
    await flush();
    expect(fake.nth(0).unsubscribed).toBe(1);
    expect(state()).toStrictEqual(EMPTY);
    expect(frames.pending()).toBe(0);
    play(B);
    await flush();
    expect(fake.streams).toHaveLength(2);
    fake.nth(1).reads.push(readOf(sine(1, -26)));
    await step();
    expectNear(state().shortTerm, -26, 0.2, '重新订阅之后');
  });

  test('宿主不接受订阅：退订、读数没有值、标 failed；换曲不重试，停止后再有曲目才再试', async () => {
    const { fake, frames, play, stop, step, state } = await setup({ outcome: REFUSED });
    expect(fake.nth(0).unsubscribed).toBe(1);
    expect(state()).toStrictEqual({ momentary: null, shortTerm: null, failed: true });
    expect(frames.pending()).toBe(0);
    play(B);
    await flush();
    expect(fake.streams).toHaveLength(1);
    stop();
    await flush();
    expect(state()).toStrictEqual(EMPTY);
    fake.outcome = OK;
    play(A);
    await flush();
    expect(fake.streams).toHaveLength(2);
    expect(state()).toStrictEqual(EMPTY);
    fake.nth(1).reads.push(readOf(sine(1, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.2, '再试之后');
  });

  test('过期应答丢弃：上一次订阅的拒绝晚到，不退订、不标 failed', async () => {
    const { fake, play, stop, step, state } = await setup({ outcome: null });
    const old = fake.nth(0);
    stop();
    await flush();
    fake.outcome = OK;
    play(B);
    await flush();
    const current = fake.nth(1);
    old.answer({ ok: false, code: 'OPERATION_FAILED' });
    await flush();
    expect(state()).toStrictEqual(EMPTY);
    expect([old.unsubscribed, current.unsubscribed]).toStrictEqual([1, 0]);
    current.reads.push(readOf(sine(1, -20)));
    await step();
    expectNear(state().shortTerm, -20, 0.2, '新订阅照读');
  });

  test('释放：退订、不再读流、不再跟曲目；在途的 ready 晚到也不写', async () => {
    const { fake, frames, service, play, stop, step, state } = await setup({ outcome: null });
    const stream = fake.nth(0);
    stream.reads.push(readOf(sine(1, -20)));
    await step();
    const last = state();
    service.dispose();
    expect(stream.unsubscribed).toBe(1);
    expect(frames.pending()).toBe(0);
    stream.answer(REFUSED);
    stream.reads.push(readOf(sine(1, -30)));
    await step();
    expect(state()).toBe(last);
    expect(stream.reads).toHaveLength(1);
    stop();
    play(A);
    await flush();
    expect(fake.streams).toHaveLength(1);
    expect(state()).toBe(last);
  });

  test('初始隐藏不订阅，恢复后只建一份流；休眠同步停帧和退订并清空积分窗', async () => {
    const x = await setup({ active: false });
    expect(x.fake.streams).toHaveLength(0);
    expect(x.frames.pending()).toBe(0);
    x.activate(true);
    x.fake.nth(0).reads.push(readOf(sine(3, -20)));
    await x.step();
    x.activate(false);
    expect(x.fake.nth(0).unsubscribed).toBe(1);
    expect(x.frames.pending()).toBe(0);
    expect(x.state()).toEqual(EMPTY);
    x.activate(true);
    x.activate(true);
    expect(x.fake.streams).toHaveLength(2);
    x.fake.nth(1).reads.push(readOf(sine(0.1, -32)));
    await x.step();
    expectNear(x.state().shortTerm, -32, 0.2, '恢复后的新积分窗');
    x.service.dispose();
    x.service.dispose();
    expect(x.fake.nth(1).unsubscribed).toBe(1);
  });

  test('旧流 ready 晚到不影响恢复后的流', async () => {
    const x = await setup({ outcome: null });
    x.activate(false);
    x.activate(true);
    x.fake.nth(0).answer(REFUSED);
    await flush();
    expect(x.fake.nth(1).unsubscribed).toBe(0);
    expect(x.state()).toEqual(EMPTY);
    expect(x.frames.pending()).toBe(1);
  });

  test('发布读数时同步休眠，当前回调不再补排下一帧', async () => {
    const x = await setup();
    const off = x.store.sub(liveLoudnessAtom, () => x.activate(false));
    x.fake.nth(0).reads.push(readOf(sine(0.1, -23)));
    await x.step();
    off();
    expect(x.frames.pending()).toBe(0);
    expect(x.fake.nth(0).unsubscribed).toBe(1);
    expect(x.state()).toEqual(EMPTY);
  });

  test('失败后休眠恢复不重试，隐藏期间停止再播放仍遵循原重试规则', async () => {
    const x = await setup({ outcome: REFUSED });
    x.activate(false);
    x.activate(true);
    expect(x.fake.streams).toHaveLength(1);
    expect(x.state().failed).toBe(true);
    x.activate(false);
    x.stop();
    await flush();
    x.play(B);
    expect(x.fake.streams).toHaveLength(1);
    x.activate(true);
    expect(x.fake.streams).toHaveLength(2);
  });
});
