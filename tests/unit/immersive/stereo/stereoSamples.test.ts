import type { AudioGetWaveformResponse } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { expect, onTestFinished, test } from 'vitest';
import type { SpectrumStatus } from '../../../../src/immersive/spectrum/spectrumHistory.ts';
import {
  accumulate,
  readingsOf,
  retainFor,
  sumsOf,
} from '../../../../src/immersive/stereo/stereoField.ts';
import {
  STEREO_POINTS,
  STEREO_POLL_FPS,
  STEREO_POLL_FPS_REDUCED,
  STEREO_WINDOW_SECONDS,
  startStereoSamples,
  stereoFieldStatusAtom,
} from '../../../../src/immersive/stereo/stereoSamples.ts';
import { watchReducedMotion } from '../../../../src/motion/reducedMotion.ts';
import { startPlayback } from '../../../../src/playback/playback.ts';
import type { PlaybackState } from '../../../../src/playback/playbackContract.ts';
import { waveformAnswer, waveformFailure } from '../../../fixtures/audioAnswers.ts';
import { fakeFrames, flush, FRAME_MS } from '../../../fixtures/fakeFrames.ts';
import { fakeMedia } from '../../../fixtures/fakeMedia.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

/**
 * 声场取数的门控、探测与读数：`audio.getWaveform` 与播放状态都经宿主替身，频谱状态是用例手里的一个 atom。
 * 帧时钟手动走（`frames.step()` 推进一拍并跑排着的回调），减弱动效经 `matchMedia` 替身给。
 */
const LEFT = [0.5, -0.5, 0.25, -0.25];
const RIGHT = [0.25, -0.25, 0.125, -0.125];
const STEREO = waveformAnswer({ left: LEFT, right: RIGHT, duration: STEREO_WINDOW_SECONDS });
/** 与 `STEREO` 反过来：这一窗自己偏右 6 dB。 */
const MIRRORED = waveformAnswer({ left: [0.25, -0.25], right: [0.5, -0.5] });

const near = (a: number | null, b: number, epsilon = 1e-9) =>
  expect(a !== null && Math.abs(a - b) < epsilon, `${a} ≠ ${b}`).toBe(true);

async function start(
  options: { reduced?: boolean; spectrum?: SpectrumStatus; active?: boolean } = {},
) {
  const host = installFakeHost();
  host.answer('audio.getWaveform', STEREO);
  const store = createStore();
  const media = fakeMedia({ '(prefers-reduced-motion: reduce)': options.reduced ?? false });
  watchReducedMotion(store, media.matchMedia);
  await startPlayback(store, host.fb).ready;
  await flush();
  const spectrumStatus = atom<SpectrumStatus>(options.spectrum ?? 'idle');
  const active = atom(options.active ?? true);
  const frames = fakeFrames();
  const stereo = startStereoSamples(store, {
    active,
    spectrumStatus,
    host: host.fb,
    frameClock: frames.clock,
    now: frames.now,
  });
  onTestFinished(() => stereo.dispose());
  const setState = async (state: PlaybackState['state']) => {
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state,
      position: 0,
      duration: 200,
      canSeek: true,
    });
    await flush();
  };
  return {
    store,
    host,
    frames,
    stereo,
    setState,
    asked: () => host.callsTo('audio.getWaveform'),
    status: () => store.get(stereoFieldStatusAtom),
    answerWith: (answer: AudioGetWaveformResponse) => host.answer('audio.getWaveform', answer),
    setSpectrum: (status: SpectrumStatus) => store.set(spectrumStatus, status),
    setActive: (value: boolean) => store.set(active, value),
    /** 频谱在出帧且正在播放：闸开。 */
    async open() {
      store.set(spectrumStatus, 'live');
      await setState('playing');
    },
  };
}

test('闸关着不问；闸开后按窗长、有符号、立体声、抽点数问，读数与点云出来', async () => {
  const t = await start();
  await t.frames.step();
  expect(t.asked()).toHaveLength(0);
  expect(t.frames.pending()).toBe(0);
  expect(t.status()).toBe('unknown');

  await t.open();
  await t.frames.step();
  expect(t.asked()).toStrictEqual([
    { duration: STEREO_WINDOW_SECONDS, signed: true, channels: 'stereo', points: STEREO_POINTS },
  ]);
  expect(t.status()).toBe('supported');
  expect(t.stereo.points()).toHaveLength(4);
  const { correlation, width, balance } = t.stereo.readings();
  near(correlation, 1);
  near(width, 1 / 9);
  near(balance, 20 * Math.log10(0.5));
});

test('隐藏优先于暂停定格，同步清空积分与样本，恢复从新的窗口开始', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  await t.setState('paused');
  expect(t.stereo.points()).toHaveLength(4);
  t.setActive(false);
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.stereo.readings().correlation).toBeNull();
  expect(t.frames.pending()).toBe(0);
  t.setActive(true);
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.frames.pending()).toBe(0);
  t.answerWith(MIRRORED);
  await t.setState('playing');
  await t.frames.step();
  near(t.stereo.readings().balance, -20 * Math.log10(0.5));
});

test('初始休眠不取数，失败记忆跨二十次休眠恢复保留', async () => {
  const t = await start({ active: false });
  await t.open();
  expect(t.frames.pending()).toBe(0);
  expect(t.asked()).toHaveLength(0);
  t.answerWith(waveformFailure('bad params', 'INVALID_PARAMS'));
  t.setActive(true);
  await t.frames.step();
  expect(t.status()).toBe('unsupported');
  for (let round = 0; round < 20; round += 1) {
    t.setActive(false);
    t.setActive(true);
    expect(t.frames.pending()).toBe(0);
  }
  expect(t.asked()).toHaveLength(1);
});

test('休眠后旧应答不覆盖恢复中的新请求', async () => {
  const t = await start();
  await t.open();
  const held = t.host.hold('audio.getWaveform');
  await t.frames.step();
  t.setActive(false);
  expect(t.frames.pending()).toBe(0);
  t.setActive(true);
  held.release();
  await flush();
  expect(t.stereo.points()).toHaveLength(0);
  await t.frames.step();
  expect(t.stereo.points()).toHaveLength(4);
});

test('发布能力结果时同步休眠，旧应答不能重新持有样本', async () => {
  const t = await start();
  const off = t.store.sub(stereoFieldStatusAtom, () => {
    if (t.status() === 'supported') t.setActive(false);
  });
  await t.open();
  await t.frames.step();
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.stereo.readings().correlation).toBeNull();
  expect(t.frames.pending()).toBe(0);
  off();
});

test('起服务时闸已经开着：不等变化，第一拍就问', async () => {
  const host = installFakeHost();
  host.answer('audio.getWaveform', STEREO);
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  await playback.ready;
  host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 0,
    duration: 200,
    canSeek: true,
  });
  await flush();
  const frames = fakeFrames();
  const stereo = startStereoSamples(store, {
    spectrumStatus: atom<SpectrumStatus>('live'),
    host: host.fb,
    frameClock: frames.clock,
    now: frames.now,
  });
  onTestFinished(() => stereo.dispose());
  await frames.step();
  expect(host.callsTo('audio.getWaveform')).toHaveLength(1);
  expect(stereo.points()).toHaveLength(4);
});

test.each([
  [false, STEREO_POLL_FPS],
  [true, STEREO_POLL_FPS_REDUCED],
])('按设定频率问（减弱动效 %s）：每秒 %i 问，不足间隔的拍子跳过', async (reduced, fps) => {
  const t = await start({ reduced });
  await t.open();
  for (let index = 0; index < 60; index += 1) await t.frames.step();
  expect(Math.abs(t.asked().length - fps), `${fps} fps: ${t.asked().length}`).toBeLessThanOrEqual(
    1,
  );
});

// 165 Hz 屏：每个 vsync 都走一拍，由帧调度按封顶 60 挑帧，挑出来的帧距是 12 / 18 ms 交替。
const VSYNC_165_MS = 1000 / 165;

test.each([
  [false, STEREO_POLL_FPS],
  [true, STEREO_POLL_FPS_REDUCED],
])(
  '165 Hz 屏上帧距不匀时仍按设定频率问（减弱动效 %s）：落到帧上的零头不累积',
  async (reduced, fps) => {
    const t = await start({ reduced });
    await t.open();
    for (let index = 0; index < 165; index += 1) await t.frames.step(VSYNC_165_MS);
    expect(Math.abs(t.asked().length - fps), `${fps} fps: ${t.asked().length}`).toBeLessThanOrEqual(
      1,
    );
  },
);

test('前一次没回就跳过这一拍，回来后再问', async () => {
  const t = await start();
  const held = t.host.hold('audio.getWaveform');
  await t.open();
  for (let index = 0; index < 10; index += 1) await t.frames.step();
  expect(t.asked()).toHaveLength(1);
  held.release();
  await flush();
  await t.frames.step();
  expect(t.asked()).toHaveLength(2);
});

test('答失败（流里还没数据）不下结论，接着问；等流里有了数据照常出读数', async () => {
  const t = await start();
  t.answerWith(waveformFailure('No waveform data available'));
  await t.open();
  for (let index = 0; index < 6; index += 1) await t.frames.step();
  expect(t.status()).toBe('unknown');
  expect(t.asked().length).toBeGreaterThanOrEqual(2);
  expect(t.stereo.readings().correlation).toBeNull();
  t.answerWith(STEREO);
  await t.frames.step();
  expect(t.status()).toBe('supported');
  expect(t.stereo.points()).toHaveLength(4);
});

test.each([
  ['只答混合声道的旧宿主', waveformAnswer({ channels: 'mix', waveform: [0.1, 0.2] })],
  ['参数被拒', waveformFailure('bad params', 'INVALID_PARAMS')],
])('%s：判不支持并停问，闸再开也不问', async (_label, answer) => {
  const t = await start();
  t.answerWith(answer);
  await t.open();
  for (let index = 0; index < 6; index += 1) await t.frames.step();
  expect(t.status()).toBe('unsupported');
  expect(t.asked()).toHaveLength(1);
  expect(t.frames.pending()).toBe(0);
  await t.setState('stopped');
  await t.setState('playing');
  for (let index = 0; index < 6; index += 1) await t.frames.step();
  expect(t.asked()).toHaveLength(1);
});

test('闸合上：停问、点与读数清空，闸合之后才到的应答丢掉', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  expect(t.stereo.points()).toHaveLength(4);

  const held = t.host.hold('audio.getWaveform');
  for (let index = 0; index < 3; index += 1) await t.frames.step();
  const asked = t.asked().length;
  await t.setState('stopped');
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.stereo.readings().correlation).toBeNull();
  held.release();
  await flush();
  expect(t.stereo.points()).toHaveLength(0);
  await t.frames.step();
  expect(t.asked()).toHaveLength(asked);
  expect(t.frames.pending()).toBe(0);
  // 支持与否已经探到了，闸合上不改结论。
  expect(t.status()).toBe('supported');
});

test('在播但频谱不再出帧（转 silent）：同样关闸清空', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  t.setSpectrum('silent');
  expect(t.stereo.points()).toHaveLength(0);
  const asked = t.asked().length;
  for (let index = 0; index < 4; index += 1) await t.frames.step();
  expect(t.asked()).toHaveLength(asked);
  t.setSpectrum('live');
  await t.frames.step();
  expect(t.asked()).toHaveLength(asked + 1);
});

test('读数按时间常数累加：新的一窗只占一部分，点云只画最近一窗', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  const before = t.stereo.readings().balance;
  t.answerWith(MIRRORED);
  for (let index = 0; index < 2; index += 1) await t.frames.step();
  const after = t.stereo.readings().balance;
  expect(t.stereo.points()).toHaveLength(2);
  // 这一窗自己偏右 6 dB；与之前偏左的累计一加权，结果落在两者之间。
  expect(before !== null && after !== null && after > before).toBe(true);
  expect(after).toBeLessThan(-20 * Math.log10(0.5));
});

test('暂停：停问，点与读数定在那一刻，恢复后接着问；暂停中停止才清空', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  const readings = t.stereo.readings();
  await t.setState('paused');
  const asked = t.asked().length;
  for (let index = 0; index < 4; index += 1) await t.frames.step();
  expect(t.asked()).toHaveLength(asked);
  expect(t.frames.pending()).toBe(0);
  expect(t.stereo.points()).toHaveLength(4);
  expect(t.stereo.readings()).toBe(readings);

  await t.setState('playing');
  await t.frames.step();
  expect(t.asked()).toHaveLength(asked + 1);
  expect(t.stereo.points()).toHaveLength(4);

  await t.setState('paused');
  await t.setState('stopped');
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.stereo.readings().correlation).toBeNull();
});

test('暂停的时长不计进读数的积分：恢复后第一窗按暂停前最后一窗到它的播放时长衰减', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  await t.setState('paused');
  for (let index = 0; index < 30; index += 1) await t.frames.step();
  t.answerWith(MIRRORED);
  await t.setState('playing');
  await t.frames.step();
  const first = sumsOf(LEFT, RIGHT);
  const second = sumsOf([0.25, -0.25], [0.5, -0.5]);
  const expected = readingsOf(accumulate(first, second, retainFor(FRAME_MS)));
  const { correlation, width, balance } = t.stereo.readings();
  near(correlation, expected.correlation ?? Number.NaN);
  near(width, expected.width ?? Number.NaN);
  near(balance, expected.balance ?? Number.NaN);
  // 把暂停的 500 ms 也算进去时，偏左的累计几乎衰减完，读数会偏右。
  const skipped = readingsOf(accumulate(first, second, retainFor(FRAME_MS * 31)));
  expect(Math.abs((balance ?? 0) - (skipped.balance ?? 0))).toBeGreaterThan(1);
});

test('暂停久到频谱转 silent：恢复播放后定着等它回到 live 再问，等的这段也不计进积分', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  const readings = t.stereo.readings();
  // 宿主的先后：暂停，2 s 没有新帧转 silent，恢复播放，之后频谱才又来帧。
  await t.setState('paused');
  t.setSpectrum('silent');
  await t.setState('playing');
  const asked = t.asked().length;
  for (let index = 0; index < 4; index += 1) await t.frames.step();
  expect(t.asked()).toHaveLength(asked);
  expect(t.stereo.points()).toHaveLength(4);
  expect(t.stereo.readings()).toBe(readings);

  t.answerWith(MIRRORED);
  t.setSpectrum('live');
  await t.frames.step();
  expect(t.asked()).toHaveLength(asked + 1);
  const expected = readingsOf(
    accumulate(sumsOf(LEFT, RIGHT), sumsOf([0.25, -0.25], [0.5, -0.5]), retainFor(FRAME_MS)),
  );
  near(t.stereo.readings().balance, expected.balance ?? Number.NaN);
});

test('恢复播放后频谱没回到 live 而是停了（页面隐藏）：关闸清空', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  await t.setState('paused');
  t.setSpectrum('silent');
  await t.setState('playing');
  expect(t.stereo.points()).toHaveLength(4);
  t.setSpectrum('idle');
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.stereo.readings().correlation).toBeNull();
});

test('减弱动效下暂停照旧清空', async () => {
  const t = await start({ reduced: true });
  await t.open();
  await t.frames.step();
  expect(t.stereo.points()).toHaveLength(4);
  await t.setState('paused');
  expect(t.stereo.points()).toHaveLength(0);
});

test('释放时有请求在途：应答回来不写点与读数，也不叫订阅方；帧调度撤掉', async () => {
  const t = await start();
  await t.open();
  await t.frames.step();
  const seen: number[] = [];
  t.stereo.subscribe(() => seen.push(t.stereo.points().length));
  const held = t.host.hold('audio.getWaveform');
  await t.frames.step();
  expect(held.pending).toHaveLength(1);
  t.stereo.dispose();
  expect(t.stereo.points()).toHaveLength(0);
  held.release();
  await flush();
  expect(t.stereo.points()).toHaveLength(0);
  expect(t.stereo.readings().correlation).toBeNull();
  expect(seen).toStrictEqual([]);
  expect(t.frames.pending()).toBe(0);
});
