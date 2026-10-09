import { atom } from 'jotai/vanilla';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { SPECTRUM_BARS } from '../../../../src/immersive/spectrum/spectrumBars.ts';
import {
  BARS_FFT_SIZE,
  SPECTRUM_FFT_SIZE,
  SPECTRUM_KEEPALIVE_FPS,
} from '../../../../src/immersive/spectrum/spectrumFeed.ts';
import {
  SILENT_MS,
  SMOOTHING_PER_60HZ,
  SMOOTHING_STALE_MS,
  SPECTRUM_FPS,
  maxFrequencyOf,
  smoothingFor,
  startSpectrumHistory,
  spectrumStatusAtom,
} from '../../../../src/immersive/spectrum/spectrumHistory.ts';
import { spectrumAnswer } from '../../../fixtures/audioAnswers.ts';
import { flush } from '../../../fixtures/fakeFrames.ts';
import {
  FAKE_FFT_SIZE,
  FAKE_SAMPLE_RATE,
  fakeHost,
  okOutcome,
  startSpectrum,
} from '../../../fixtures/spectrumHost.ts';

/**
 * 频谱取数的门控、订阅与历史缓冲，替身与起服务的助手在 `fixtures/spectrumHost.ts`。两份订阅的结局与退订
 * （`spectrumFeed.ts`）经服务一起测；拉取节奏本身的用例在 `spectrumPull.test.ts`。
 */
afterEach(() => {
  vi.useRealTimers();
});

test('主订阅退订抛错仍退掉短窗订阅，停止计时并清空历史', async () => {
  fakeTimers();
  const fake = fakeHost();
  const subscribe = fake.host.audio.subscribeSpectrum;
  vi.spyOn(fake.host.audio, 'subscribeSpectrum').mockImplementation((callback, options) => {
    const stream = subscribe(callback, options);
    return Object.assign(
      () => {
        stream();
        if (options?.fftSize === SPECTRUM_FFT_SIZE) throw new Error('退订失败');
      },
      { ready: stream.ready },
    );
  });
  const x = startSpectrum(fake);
  await flush();
  fake.play(-30);
  await x.frames.step();
  expect(() => x.setHidden(true)).toThrow('退订失败');
  expect(fake.subscriptions.map((entry) => entry.closes)).toEqual([1, 1]);
  expect(x.frames.pending()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(x.spectrum.history.data.byteLength).toBe(0);
  expect(x.spectrum.frame()).toBeNull();
  x.spectrum.dispose();
});

test('发布首帧时同步隐藏，旧回调不能重新挂计时或保留帧', async () => {
  fakeTimers();
  const fake = fakeHost();
  const x = startSpectrum(fake);
  await flush();
  const off = x.store.sub(spectrumStatusAtom, () => {
    if (x.status() === 'live') x.setHidden(true);
  });
  fake.play(-30);
  await x.frames.step();
  expect(x.status()).toBe('idle');
  expect(x.spectrum.frame()).toBeNull();
  expect(x.spectrum.history.data.byteLength).toBe(0);
  expect(x.frames.pending()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  off();
  x.spectrum.dispose();
});

/** 只换 setTimeout：帧时钟与 flush 用的 setImmediate 照走真的。 */
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

const subscribeOptions = (fftSize: number) => ({
  output: 'bins',
  fftSize,
  fps: SPECTRUM_KEEPALIVE_FPS,
});

test('起服务：问一次可用性、订两份 1 fps 频点输出的保活订阅（山脊图 16384 点、频谱柱短窗）；订上后每拍两份各拉一帧，新帧写缓冲推版本转 live', async () => {
  const fake = fakeHost();
  const { spectrum, frames, status } = startSpectrum(fake);
  expect(status()).toBe('idle');
  await flush();
  expect(fake.asked()).toBe(1);
  expect(fake.open()).toHaveLength(2);
  expect(fake.subscriptions[0]?.options).toStrictEqual(subscribeOptions(SPECTRUM_FFT_SIZE));
  expect(fake.subscriptions[1]?.options).toStrictEqual(subscribeOptions(BARS_FFT_SIZE));
  expect(spectrum.interval()).toBe(1000 / SPECTRUM_FPS);
  expect(spectrum.frame()).toBeNull();
  fake.play(-30);
  await frames.step();
  expect(fake.pulls).toStrictEqual([
    { subscriptionId: 'spectrum-1' },
    { subscriptionId: 'spectrum-2' },
  ]);
  fake.play(-20);
  await frames.step();
  expect(fake.pulls).toHaveLength(4);
  expect(spectrum.version()).toBe(2);
  expect(spectrum.frame()?.values[0]).toBe(-20);
  expect(spectrum.frame()?.binHz).toBe(FAKE_SAMPLE_RATE / FAKE_FFT_SIZE);
  expect(status()).toBe('live');
  expect(spectrum.history.count).toBe(2);
});

test('subscribe：每收一帧叫一次，叫的时候缓冲、frame 与 version 已是这一帧的；退订后不再叫', async () => {
  const fake = fakeHost();
  const { spectrum, frames } = startSpectrum(fake);
  await flush();
  const seen: [number, number | undefined, number][] = [];
  const off = spectrum.subscribe(() =>
    seen.push([spectrum.version(), spectrum.frame()?.values[0], spectrum.history.count]),
  );
  fake.play(-30);
  await frames.step();
  await frames.step();
  fake.play(-20);
  await frames.step();
  expect(seen).toStrictEqual([
    [1, -30, 1],
    [2, -20, 2],
  ]);
  off();
  fake.play(-10);
  await frames.step();
  expect(spectrum.version()).toBe(3);
  expect(seen).toHaveLength(2);
});

test('宿主还没出新帧：重复的帧、没有 spectrum 的帧与频带帧不进缓冲；2 s 没有新帧转 silent，再来新帧回 live', async () => {
  fakeTimers();
  const fake = fakeHost();
  const { spectrum, frames, status } = startSpectrum(fake);
  await flush();
  fake.play(0.5);
  await frames.step();
  await frames.step();
  await frames.step();
  expect(fake.pullsOf('spectrum-1')).toBe(3);
  expect(spectrum.version(), '同一帧拉到三次只收一次').toBe(1);
  vi.advanceTimersByTime(SILENT_MS);
  expect(status()).toBe('silent');
  fake.play(0.1);
  await frames.step();
  expect(status()).toBe('live');
  expect(spectrum.version()).toBe(2);
  fake.answerWith(spectrumAnswer({ streamTime: 99 }));
  await frames.step();
  expect(spectrum.version(), '成功应答但没有 spectrum 也不进缓冲').toBe(2);
  fake.answerWith(spectrumAnswer({ output: 'bands', streamTime: 100, spectrum: [0.5, 0.5] }));
  await frames.step();
  expect(spectrum.version(), '频带帧也不进').toBe(2);
});

test('宿主答可视化不可用或问不到 → unavailable 且不订；无宿主 → unavailable 且连问都不问', async () => {
  const refused = fakeHost({ visualization: false });
  const first = startSpectrum(refused);
  await flush();
  expect(first.status()).toBe('unavailable');
  expect(refused.asked()).toBe(1);
  expect(refused.subscriptions).toHaveLength(0);

  const failing = fakeHost({ askFails: true });
  const second = startSpectrum(failing);
  await flush();
  expect(second.status()).toBe('unavailable');
  expect(failing.subscriptions).toHaveLength(0);

  const absent = fakeHost({ available: false });
  const third = startSpectrum(absent);
  await flush();
  expect(third.status()).toBe('unavailable');
  expect(absent.asked()).toBe(0);
  expect(absent.subscriptions).toHaveLength(0);
});

test('起步时页面就隐藏：不问不订，状态 idle；回到前台才问、才订', async () => {
  const fake = fakeHost();
  const { status, setHidden } = startSpectrum(fake, { hidden: true });
  await flush();
  expect(status()).toBe('idle');
  expect(fake.asked()).toBe(0);
  expect(fake.subscriptions).toHaveLength(0);
  setHidden(false);
  await flush();
  expect(fake.asked()).toBe(1);
  expect(fake.open()).toHaveLength(2);
});

test('页面隐藏退订停拉转 idle，计时一起清；回到前台重新订一份新的', async () => {
  fakeTimers();
  const fake = fakeHost();
  const { spectrum, frames, status, setHidden } = startSpectrum(fake);
  await flush();
  fake.play(0.5);
  await frames.step();
  setHidden(true);
  expect(spectrum.history.data.byteLength).toBe(0);
  expect(spectrum.history.count).toBe(0);
  expect(spectrum.frame()).toBeNull();
  expect(frames.pending()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  await flush();
  expect(fake.open()).toHaveLength(0);
  expect(fake.subscriptions.map((entry) => entry.closes)).toStrictEqual([1, 1]);
  expect(status()).toBe('idle');
  expect(frames.pending()).toBe(0);
  const pulled = fake.pulls.length;
  await frames.step();
  expect(fake.pulls).toHaveLength(pulled);
  vi.advanceTimersByTime(SILENT_MS);
  expect(status()).toBe('idle');
  setHidden(false);
  await flush();
  expect(fake.subscriptions).toHaveLength(4);
  expect(fake.open()).toHaveLength(2);
  fake.play(0.6);
  await frames.step();
  expect(fake.pulls.slice(-2)).toStrictEqual([
    { subscriptionId: 'spectrum-3' },
    { subscriptionId: 'spectrum-4' },
  ]);
  expect(spectrum.history.count).toBe(1);
});

test('减弱动效下每 4 拍（15 fps）才拉一次；页面隐藏退订、回来再订', async () => {
  const fake = fakeHost();
  const { setHidden, frames, spectrum } = startSpectrum(fake, { reduced: true });
  await flush();
  expect(spectrum.interval()).toBe(1000 / 15);
  for (let index = 0; index < 20; index += 1) {
    fake.play(0.5);
    await frames.step();
  }
  expect(fake.pullsOf('spectrum-1')).toBe(5);
  expect(fake.pullsOf('spectrum-2')).toBe(5);
  setHidden(true);
  await flush();
  expect(fake.open()).toHaveLength(0);
  setHidden(false);
  await flush();
  expect(fake.open()).toHaveLength(2);
  expect(fake.subscriptions).toHaveLength(4);
});

test('逐带平滑按帧距折算：60 Hz 一帧留一个系数、30 fps 一帧留它的平方，停发后再来的帧不混；帧距按实测滑动平均', async () => {
  expect(smoothingFor(0)).toBe(0);
  expect(smoothingFor(Number.NaN)).toBe(0);
  expect(Math.abs(smoothingFor(1000 / 60) - SMOOTHING_PER_60HZ)).toBeLessThan(1e-9);
  expect(Math.abs(smoothingFor(1000 / 30) - SMOOTHING_PER_60HZ ** 2)).toBeLessThan(1e-9);
  expect(smoothingFor(SMOOTHING_STALE_MS + 1)).toBe(0);

  const fake = fakeHost();
  const { spectrum, frames } = startSpectrum(fake);
  await flush();
  // 柱高按 −60…0 dB 线性铺：0 dB 换成柱高 1、−60 dB 换成 0。
  const playLevel = (level: number) => {
    fake.play(-60 + 60 * level);
    fake.playBars(-60 + 60 * level);
  };
  const firstBar = () => spectrum.history.row(0)[0] ?? -1;
  playLevel(1);
  await frames.step();
  playLevel(0);
  await frames.step(1000 / 60);
  expect(Math.abs(firstBar() - SMOOTHING_PER_60HZ), '60 Hz 一帧留一个系数').toBeLessThan(1e-6);
  playLevel(0);
  await frames.step(1000 / 30);
  expect(Math.abs(firstBar() - SMOOTHING_PER_60HZ ** 3), '30 fps 一帧留系数的平方').toBeLessThan(
    1e-6,
  );
  playLevel(1);
  await frames.step(SMOOTHING_STALE_MS + 1);
  expect(firstBar(), '停发后再来的帧照收不混').toBe(1);
  // 帧距：起步按拉取帧率，之后每帧向实测靠 0.2；超过 1 s 的不算数。
  const before = spectrum.interval();
  fake.play(0.5);
  await frames.step(50);
  expect(Math.abs(spectrum.interval() - (before + (50 - before) * 0.2))).toBeLessThan(1e-9);
  const held = spectrum.interval();
  fake.play(0.5);
  await frames.step(5000);
  expect(spectrum.interval()).toBe(held);
});

test('问可用性期间页面隐藏：晚到的应答不订', async () => {
  const fake = fakeHost();
  fake.hold();
  const { status, setHidden } = startSpectrum(fake);
  await flush();
  expect(fake.asked()).toBe(1);
  expect(fake.subscriptions).toHaveLength(0);
  setHidden(true);
  await flush();
  fake.answer();
  await flush();
  expect(fake.subscriptions).toHaveLength(0);
  expect(status()).toBe('idle');
});

test('问可用性期间释放：晚到的应答不订，状态停在 idle', async () => {
  const fake = fakeHost();
  fake.hold();
  const { spectrum, status } = startSpectrum(fake);
  await flush();
  spectrum.dispose();
  fake.answer();
  await flush();
  expect(fake.subscriptions).toHaveLength(0);
  expect(status()).toBe('idle');
});

test('宿主拒绝订阅 → unavailable：两份各退一次、不拉，2 s 后也不改报 silent', async () => {
  fakeTimers();
  const fake = fakeHost({ refuse: true });
  const { frames, status, setHidden } = startSpectrum(fake);
  await flush();
  expect(fake.subscriptions.map((entry) => entry.closes)).toStrictEqual([1, 1]);
  expect(status()).toBe('unavailable');
  await frames.step();
  expect(fake.pulls).toHaveLength(0);
  vi.advanceTimersByTime(SILENT_MS);
  expect(status()).toBe('unavailable');
  setHidden(true);
  await flush();
  expect(status()).toBe('idle');
});

test('订阅结局晚于闸关才到：旧订阅的结局不碰新订阅，新订阅成立后才开拉', async () => {
  const fake = fakeHost({ deferReady: true });
  const { frames, status, setHidden } = startSpectrum(fake);
  await flush();
  setHidden(true);
  await flush();
  setHidden(false);
  await flush();
  expect(fake.subscriptions).toHaveLength(4);
  fake.subscriptions[0]?.settle({ ok: false, code: 'INVALID_PARAMS' });
  fake.subscriptions[1]?.settle({ ok: false, code: 'INVALID_PARAMS' });
  await flush();
  expect(fake.subscriptions[2]?.closed).toBe(false);
  expect(fake.subscriptions[3]?.closed).toBe(false);
  expect(status()).not.toBe('unavailable');
  fake.play(0.5);
  await frames.step();
  expect(fake.pulls, '新订阅的结局没到，不拉').toHaveLength(0);
  fake.subscriptions[2]?.settle(okOutcome(3));
  await flush();
  await frames.step();
  expect(fake.pulls, '柱那份还没成立，只拉山脊图那份').toStrictEqual([
    { subscriptionId: 'spectrum-3' },
  ]);
  expect(status()).toBe('live');
  fake.subscriptions[3]?.settle(okOutcome(4));
  await flush();
  fake.play(0.6);
  await frames.step();
  expect(fake.pulls.slice(1)).toStrictEqual([
    { subscriptionId: 'spectrum-3' },
    { subscriptionId: 'spectrum-4' },
  ]);
});

test('释放时订阅结局还没到：两份都已退订，结局晚到也不开拉', async () => {
  const fake = fakeHost({ deferReady: true });
  const { spectrum, frames } = startSpectrum(fake);
  await flush();
  spectrum.dispose();
  expect(fake.subscriptions.map((entry) => entry.closes)).toStrictEqual([1, 1]);
  fake.subscriptions[0]?.settle(okOutcome(1));
  fake.subscriptions[1]?.settle(okOutcome(2));
  await flush();
  fake.play(0.5);
  await frames.step();
  expect(fake.pulls).toHaveLength(0);
  expect(frames.pending()).toBe(0);
});

test('频谱柱吃自己那份订阅的频点帧、并带换成柱高写进缓冲，山脊图的频点仍取长窗那份', async () => {
  const fake = fakeHost();
  const { spectrum, frames } = startSpectrum(fake);
  await flush();
  fake.play(-10);
  fake.playBars(-30);
  await frames.step();
  expect(spectrum.frame()?.values).toHaveLength(FAKE_FFT_SIZE / 2 - 1);
  expect(spectrum.frame()?.values[0]).toBe(-10);
  expect(spectrum.history.bands).toBe(SPECTRUM_BARS);
  // 第 0 带取频点 1 的 −30 dB，落在 −60…0 的正中。
  expect(Math.abs((spectrum.history.row(0)[0] ?? -1) - 0.5)).toBeLessThan(1e-6);
});

test('旧宿主不认 output、结局报频带输出：按被拒处理，两份各退一次、不拉，报 unavailable', async () => {
  const fake = fakeHost({ legacyOutput: true });
  const { frames, status } = startSpectrum(fake);
  await flush();
  expect(fake.subscriptions.map((entry) => entry.closes)).toStrictEqual([1, 1]);
  expect(status()).toBe('unavailable');
  fake.play(-10);
  await frames.step();
  expect(fake.pulls).toHaveLength(0);
});

test('暂停时回的那一帧静音不进柱缓冲，柱停在暂停前；照样放给山脊图', async () => {
  const fake = fakeHost();
  const { spectrum, frames } = startSpectrum(fake);
  await flush();
  fake.play(-30);
  await frames.step();
  fake.play(-160, { state: 'paused' });
  await frames.step();
  expect(spectrum.version()).toBe(2);
  expect(spectrum.history.count).toBe(1);
  expect(Math.abs((spectrum.history.row(0)[0] ?? -1) - 0.5)).toBeLessThan(1e-6);
  expect(spectrum.frame()?.values[0]).toBe(-160);
});

test('柱那份成立了却没拉到这一拍：缓冲不动，不混进山脊图那份的帧', async () => {
  const fake = fakeHost();
  const { spectrum, frames } = startSpectrum(fake);
  await flush();
  fake.play(-10);
  fake.playBars(-30);
  await frames.step();
  fake.failBars(true);
  fake.play(-12);
  await frames.step();
  expect(spectrum.version()).toBe(2);
  expect(spectrum.history.count).toBe(1);
  expect(Math.abs((spectrum.history.row(0)[0] ?? -1) - 0.5)).toBeLessThan(1e-6);
});

test('柱那份被拒：退掉它且只退一次，只拉山脊图那份，柱吃它的帧、按同一把尺换算', async () => {
  const fake = fakeHost({ refuseBars: true });
  const { spectrum, frames, status, setHidden } = startSpectrum(fake);
  await flush();
  expect(fake.subscriptions[1]?.closes).toBe(1);
  fake.play(-30);
  await frames.step();
  expect(fake.pulls).toStrictEqual([{ subscriptionId: 'spectrum-1' }]);
  expect(status()).toBe('live');
  expect(Math.abs((spectrum.history.row(0)[0] ?? -1) - 0.5)).toBeLessThan(1e-6);
  setHidden(true);
  await flush();
  expect(fake.subscriptions.map((entry) => entry.closes)).toStrictEqual([1, 1]);
});

test('横轴上沿取帧自报的 maxFrequency：0 沿用上一次，闸关清空', async () => {
  expect(maxFrequencyOf({ spectrum: [], maxFrequency: 22050 })).toBe(22050);
  expect(maxFrequencyOf({ spectrum: [], maxFrequency: 0 })).toBeNull();
  expect(maxFrequencyOf({ spectrum: [], maxFrequency: Number.NaN })).toBeNull();
  expect(maxFrequencyOf({ spectrum: [], maxFrequency: '24000' })).toBeNull();
  expect(maxFrequencyOf({ spectrum: [] })).toBeNull();
  expect(maxFrequencyOf(null)).toBeNull();

  const fake = fakeHost();
  const { frames, maxFrequency, setHidden } = startSpectrum(fake);
  await flush();
  expect(maxFrequency()).toBeNull();
  fake.play(0.5);
  await frames.step();
  expect(maxFrequency()).toBe(FAKE_SAMPLE_RATE / 2);
  fake.play(0.5, { maxFrequency: 24000 });
  await frames.step();
  expect(maxFrequency()).toBe(24000);
  fake.play(0, { maxFrequency: 0 });
  await frames.step();
  expect(maxFrequency()).toBe(24000);
  fake.play(0.5);
  await frames.step();
  expect(maxFrequency()).toBe(FAKE_SAMPLE_RATE / 2);
  setHidden(true);
  await flush();
  expect(maxFrequency()).toBeNull();
});

test('释放：退订、停拉、可见性监听摘掉，状态回 idle', async () => {
  const fake = fakeHost();
  const { listeners, spectrum, frames, status } = startSpectrum(fake);
  await flush();
  expect(listeners.size).toBe(1);
  spectrum.dispose();
  await flush();
  expect(fake.open()).toHaveLength(0);
  expect(listeners.size).toBe(0);
  expect(frames.pending()).toBe(0);
  expect(status()).toBe('idle');
  fake.play(0.5);
  await frames.step();
  expect(fake.pulls).toHaveLength(0);
  expect(spectrum.version()).toBe(0);
});

test('释放时拉取在途：应答回来不写缓冲、不推版本、不改状态', async () => {
  const fake = fakeHost();
  const { spectrum, frames, status } = startSpectrum(fake);
  await flush();
  fake.holdPulls();
  fake.play(-30);
  await frames.step();
  expect(fake.pulls).toHaveLength(2);
  spectrum.dispose();
  fake.releasePulls();
  await flush();
  expect(spectrum.version()).toBe(0);
  expect(spectrum.history.count).toBe(0);
  expect(status()).toBe('idle');
});

test('新服务起来之后旧的才释放：状态与上沿归新服务写，旧的释放时不盖回 idle', async () => {
  const fake = fakeHost();
  const old = startSpectrum(fake);
  await flush();
  const current = startSpectrumHistory(old.store, {
    host: fake.host,
    visibility: { hidden: () => false, subscribe: () => () => {} },
    now: old.frames.now,
    frameClock: old.frames.clock,
  });
  onTestFinished(() => current.dispose());
  await flush();
  fake.play(0.5, { maxFrequency: 24000 });
  await old.frames.step();
  expect(current.version()).toBe(1);
  expect(old.status()).toBe('live');
  old.spectrum.dispose();
  await flush();
  expect(old.status()).toBe('live');
  expect(old.maxFrequency()).toBe(24000);
  current.dispose();
  expect(old.status()).toBe('idle');
  expect(old.maxFrequency()).toBeNull();
});

test('山脊图关着：只订柱那份短窗，由它拉帧、报状态，frame 一直是 null；开关变了退掉旧的、按新的份数重订', async () => {
  const fake = fakeHost();
  const terrain = atom(false);
  const { store, spectrum, frames, status } = startSpectrum(fake, { terrain });
  await flush();
  expect(fake.open()).toHaveLength(1);
  expect(fake.subscriptions[0]?.options).toStrictEqual(subscribeOptions(BARS_FFT_SIZE));
  fake.play(-30);
  await frames.step();
  expect(fake.pulls).toStrictEqual([{ subscriptionId: 'spectrum-1' }]);
  expect(status()).toBe('live');
  expect(spectrum.history.count).toBe(1);
  expect(spectrum.frame()).toBeNull();

  store.set(terrain, true);
  await flush();
  expect(fake.subscriptions[0]?.closes).toBe(1);
  expect(fake.open()).toHaveLength(2);
  expect(fake.subscriptions[1]?.options).toStrictEqual(subscribeOptions(SPECTRUM_FFT_SIZE));
  fake.play(-20);
  await frames.step();
  expect(spectrum.frame()?.values[0]).toBe(-20);
});

test('山脊图关着时柱那份被拒：按主订阅被拒处理，报 unavailable、不拉', async () => {
  const fake = fakeHost({ refuseBars: true });
  const { frames, status } = startSpectrum(fake, { terrain: atom(false) });
  await flush();
  await frames.step();
  expect(status()).toBe('unavailable');
  expect(fake.open()).toHaveLength(0);
  expect(fake.subscriptions[0]?.closes).toBe(1);
  expect(fake.pulls).toStrictEqual([]);
});
