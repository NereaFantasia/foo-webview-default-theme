import type { AudioSpectrumPayload } from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';
import type { FrameClock } from '../frame/frameScheduler.ts';

/**
 * 背景渲染器的低频音量：开了「随音乐律动」就订一份频段输出，逐条归一后取平均，交给渲染器；
 * 关着、暂停、静态时订阅退掉。订阅和取值自己写在这里，不借图纸场景的频谱（`backdrop/` 不能导入旧目录）
 *
 * 宿主的频段值是 -50…0 dB 映射到 0…1 再取 0.8 次幂，动态范围较窄且低音基线持续偏高。为准确提取动态起伏，
 * 通过滑动时间窗口统计各频段最近数秒内的能量分布，并按分位数归一化律动强度，使响度变化的曲目均能快速自适应基线。
 * 采用分位数而非极值进行归一化，避免偶发极端低值拉偏基线导致后续普通波动持续溢出
 *
 * 帧只更新目标值，推到渲染器的值由帧时钟逐拍追：宿主推帧的定时器不匀，后台还会被限到 12 帧/秒，
 * 而网格渐变把音量直接加进旋转相位、上游不做平滑，值不能跳。追的快慢分两档：上升快、回落慢，
 * 鼓点才有劲、又不抖
 */

/** 订阅用的宿主面，类型取自 SDK 的 `fb.audio` */
export type LowFreqHost = Pick<typeof fb.audio, 'subscribeSpectrum'>;

/**
 * 订的频段：低频一段分成 `AUDIO_BANDS` 条（宿主下限 8 条，按对数分），上沿 200 Hz 以下是鼓和贝斯的基频。
 * 4096 点在 44.1 kHz 下窗长约 93 ms、频点间隔约 10.8 Hz：默认的 1024 点一个频点就有 43 Hz，
 * 这一段的每一条都比频点还窄，分不出鼓和贝斯。推帧 30 次/秒够追了，宿主按各订阅里最高的推帧率走，
 * 订得比图纸场景那份的 1 帧/秒高，订阅在时整个宿主的推帧率跟着涨
 */
export const AUDIO_BANDS = 8;
export const AUDIO_MIN_HZ = 30;
export const AUDIO_MAX_HZ = 200;
export const AUDIO_FFT_SIZE = 4096;
export const AUDIO_FPS = 30;
/** 帧不走默认事件名：别的订阅的监听器看不到这一份 */
export const AUDIO_EVENT = 'audio:spectrum:backdrop';

/** 归一参照的时间窗，毫秒：每条取窗内样本的这两个分位当 0 和 1 */
export const WINDOW_MS = 3000;
export const LOW_QUANTILE = 0.3;
export const HIGH_QUANTILE = 0.7;
/** 两个分位之间至少隔这么宽才归一：近乎恒定的信号不放大噪声 */
export const MIN_SPAN = 0.12;
/** 音量追目标的时间常数，毫秒：上升快、回落慢 */
export const RISE_MS = 60;
export const FALL_MS = 240;
/** 离开音频（暂停、关掉开关）时缓动到静止值的时间常数，毫秒 */
export const REST_MS = 300;
/** 两帧之间的间隔上限，毫秒：停了很久再来的帧不按那么长的间隔折算 */
const MAX_STEP_MS = 100;
/** 追到离目标这么近就算到了；变化不到这么多的拍不推给渲染器 */
const SETTLED = 0.002;

/**
 * - `follow`：订音频，音量跟着低频走
 * - `pause`：退订，音量缓动回 0（开着随音乐律动但没在播放）
 * - `constant`：退订，音量缓动到 `restVolume`（没开随音乐律动，等于不接音频）
 * - `hold`：退订，音量停在原地（静态模式，画面不动，没有可见变化）
 */
export type LowFreqMode = 'follow' | 'pause' | 'constant' | 'hold';

export interface LowFreqDrive {
  set(mode: LowFreqMode): void;
  /** 退订并停掉一切，之后不再回调 */
  dispose(): void;
}

export interface LowFreqOptions {
  host: LowFreqHost;
  clock: FrameClock;
  /** 没开随音乐律动时交给渲染器的固定值，也是订阅被拒时退回的值；驱动建起来时渲染器里就是它 */
  restVolume: number;
  onVolume(volume: number): void;
  /** 跟随音频时低频音量的倍数，每来一帧取一次，缺省 1；恒定与暂停不受它影响 */
  gain?: () => number;
  /** 毫秒时刻，缺省 `performance.now` */
  now?: () => number;
}

/** 适配层建渲染器时用它建驱动；宿主与帧时钟之外的部分由适配层给 */
export type LowFreqFactory = (
  options: Pick<LowFreqOptions, 'clock' | 'restVolume' | 'onVolume' | 'gain'>,
) => LowFreqDrive;

/** 一帧里的各条；不是数组或其中不是有限数的条不计 */
export function cleanBands(bands: unknown): number[] {
  if (!Array.isArray(bands)) return [];
  const kept: number[] = [];
  for (const value of bands) {
    if (typeof value === 'number' && Number.isFinite(value)) kept.push(value);
  }
  return kept;
}

/** 已排序数组的分位数，下标取整 */
function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
}

/**
 * 逐条各自拿最近 `WINDOW_MS` 里的样本归一，再取各条的平均，得 0…1：窗内低分位以下得 0、高分位以上得 1。
 * 比平时低的帧得 0，比平时高的帧得 1，近乎恒定的信号得 0 附近。窗里没有样本（刚开始、或停了很久再来）
 * 就从头攒，第一帧得 0。一条都没有按静音得 0
 */
export function createLevelFollower() {
  const samples: { time: number; bands: readonly number[] }[] = [];
  return {
    push(bands: readonly number[], timeMs: number): number {
      samples.push({ time: timeMs, bands });
      while (samples.length > 0 && samples[0]!.time < timeMs - WINDOW_MS) samples.shift();
      if (bands.length === 0) return 0;
      let sum = 0;
      bands.forEach((value, index) => {
        const column = samples
          .map((sample) => sample.bands[index])
          .filter((sample): sample is number => sample !== undefined)
          .sort((x, y) => x - y);
        const low = quantile(column, LOW_QUANTILE);
        const high = quantile(column, HIGH_QUANTILE);
        sum += Math.min(1, Math.max(0, (value - low) / Math.max(high - low, MIN_SPAN)));
      });
      return sum / bands.length;
    },
  };
}

/**
 * 建一个低频音量驱动，与渲染器同生命周期。不在 `follow` 时没有订阅也没有逐拍的追赶；
 * 订阅被宿主拒绝就退回 `restVolume` 并不再重订，开关仍是用户设的值
 */
export function createLowFreqDrive(options: LowFreqOptions): LowFreqDrive {
  const { host, clock, restVolume } = options;
  const now = options.now ?? (() => performance.now());
  const follower = createLevelFollower();
  /** 实际生效的模式：订阅被拒之后，要求 `follow`、`pause` 都按 `constant` 走 */
  let mode: LowFreqMode = 'constant';
  let refused = false;
  let disposed = false;
  let volume = restVolume;
  let emitted = restVolume;
  let target = restVolume;
  let lastStep: number | undefined;
  let handle: number | undefined;
  let subscription: ReturnType<LowFreqHost['subscribeSpectrum']> | undefined;

  function emit(next: number): void {
    emitted = next;
    options.onVolume(next);
  }

  function step(time: number): void {
    handle = undefined;
    if (disposed) return;
    const elapsed =
      lastStep === undefined ? 0 : Math.min(MAX_STEP_MS, Math.max(0, time - lastStep));
    lastStep = time;
    const following = mode === 'follow';
    const rise = following ? RISE_MS : REST_MS;
    const fall = following ? FALL_MS : REST_MS;
    volume += (target - volume) * (1 - Math.exp(-elapsed / (target > volume ? rise : fall)));
    if (!following && Math.abs(target - volume) < SETTLED) {
      // 到了静止值：写准这一个值，循环就此结束，下次从头计时
      volume = target;
      lastStep = undefined;
      if (volume !== emitted) emit(volume);
      return;
    }
    if (Math.abs(volume - emitted) >= SETTLED) emit(volume);
    schedule();
  }

  function schedule(): void {
    if (handle === undefined && !disposed) handle = clock.request(step);
  }

  function stopLoop(): void {
    if (handle !== undefined) clock.cancel(handle);
    handle = undefined;
    lastStep = undefined;
  }

  function unsubscribe(): void {
    const stop = subscription;
    subscription = undefined;
    stop?.();
  }

  function onFrame(frame: AudioSpectrumPayload): void {
    if (mode !== 'follow') return;
    // 暂停与停止时宿主给的静音帧按全零算，也进窗口
    const bands = cleanBands(frame.spectrum);
    const silent = frame.state === 'playing' ? bands : bands.map(() => 0);
    target = follower.push(silent, now()) * (options.gain?.() ?? 1);
  }

  function refuse(): void {
    refused = true;
    unsubscribe();
    if (mode !== 'follow') return;
    mode = 'constant';
    target = restVolume;
    schedule();
  }

  function subscribe(): void {
    if (subscription || refused) return;
    let current: ReturnType<LowFreqHost['subscribeSpectrum']>;
    try {
      current = host.subscribeSpectrum(onFrame, {
        output: 'bands',
        bands: AUDIO_BANDS,
        fftSize: AUDIO_FFT_SIZE,
        fps: AUDIO_FPS,
        minFrequency: AUDIO_MIN_HZ,
        maxFrequency: AUDIO_MAX_HZ,
        event: AUDIO_EVENT,
      });
    } catch {
      refuse();
      return;
    }
    subscription = current;
    void current.ready.then((outcome) => {
      if (subscription !== current || disposed) return;
      if (!outcome.ok || outcome.output !== 'bands') refuse();
    });
  }

  return {
    set(requested) {
      const next =
        refused && (requested === 'follow' || requested === 'pause') ? 'constant' : requested;
      if (disposed || next === mode) return;
      mode = next;
      if (next === 'follow') {
        subscribe();
        // 同步订阅就被拒时模式已改回 `constant`，目标由 `refuse` 定
        if (mode === 'follow') schedule();
        return;
      }
      unsubscribe();
      if (next === 'hold') {
        stopLoop();
        target = volume;
        return;
      }
      target = next === 'pause' ? 0 : restVolume;
      schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      unsubscribe();
    },
  };
}
