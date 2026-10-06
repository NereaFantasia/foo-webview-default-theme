import {
  attackFor,
  groupBands,
  releaseFor,
  settleBars,
  settlePeaks,
  SPECTRUM_BARS,
} from './spectrumBars.ts';

/**
 * 频谱柱与柱顶峰值点的逐帧推进，不碰 DOM。时刻一律是 `performance.now()` 那条时间轴上的毫秒。
 *
 * 目标柱高：取数在出帧、在播放且帧还新鲜时取缓冲里最新的一帧，否则归零。柱起音瞬到、回落按经过的时间衰减；
 * 峰值点冲上来即跟、停一会再匀速落（`spectrumBars.ts`）。帧停了（超过几个帧距没新帧，或者没在播放）柱落到底，
 * `step` 答不用再画，下一帧到了由调用方再排。
 *
 * 暂停时画面上还有柱或峰值点就定格：柱与峰值点不收帧、不下落。恢复播放时把几个按时间走的量（上次重画、上次来帧、
 * 峰值点停到哪一刻）一起往后挪暂停的时长，下落与峰值从暂停前接着算，第一帧不跳。
 *
 * 断点（seek、手动换曲，或从没在出帧变成在播放出帧）之后的一段时间里起音不瞬到、按时间追向目标（`attackFor`），
 * 峰值点不再停留、直接开始落：内容整段换了，不让新谱一帧拍上去。
 *
 * 减弱动效（`smooth` 为假）下不做下落平滑、不走峰值点、暂停也不定格，柱直接跟随目标；没在播放就按零。
 */

/** 没新帧超过这么久（毫秒，且不少于四个帧距）就当帧停了，柱往零落。与山脊图（`terrainPainter.ts`）的判据同值。 */
export const SETTLE_MS = 500;

/** 每一步现读的外部状态。 */
export interface SpectrumInput {
  /** 取数在出帧（`spectrumStatusAtom` 为 `live`）。 */
  readonly live: boolean;
  readonly playing: boolean;
  /** 实测帧距（毫秒）。 */
  readonly interval: number;
  /** 最新一帧的柱高（0…1）；缓冲还空着或取数服务没起来时为 `null`。 */
  readonly latest: ArrayLike<number> | null;
}

export interface SpectrumMotion {
  /** 各柱此刻的高（0…1），画的一方只读。 */
  readonly levels: Float32Array;
  /** 各峰值点此刻的高（0…1），画的一方只读。 */
  readonly peaks: Float32Array;
  /** 暂停定格着：画面照原样重画，不推进。 */
  holding(): boolean;
  /** 收到一帧。定格中不记：恢复时来帧时刻随暂停的时长一起后挪。 */
  frameArrived(now: number): void;
  /** 排重画时调：还没画过就把起点记在这一刻，第一步的下落与起音按排到画之间的时长算。 */
  touch(now: number): void;
  /** 暂停。`smooth` 为真且画面上有柱或峰值点时定格。 */
  pause(now: number, smooth: boolean): void;
  /** 恢复播放。在定格就解除，并把按时间走的量后挪暂停的时长。 */
  resume(now: number): void;
  /** 不再定格（订阅撤掉：页面隐藏、退出、宿主拒绝），之后照常按零落。 */
  release(): void;
  /** 断点：之后 `windowMs` 毫秒里起音按时间追向目标，峰值点从这一刻起就落。`windowMs` 不大于 0 时起音照常瞬到。 */
  soften(now: number, windowMs: number): void;
  /** 推进到 `now`；答还要不要接着画下一刻。定格中什么都不动，答假。 */
  step(now: number, input: SpectrumInput, smooth: boolean): boolean;
}

export function createSpectrumMotion(): SpectrumMotion {
  const levels = new Float32Array(SPECTRUM_BARS);
  const target = new Float32Array(SPECTRUM_BARS);
  const peaks = new Float32Array(SPECTRUM_BARS);
  const peakHeldUntil = new Float64Array(SPECTRUM_BARS);
  let lastFrameAt = 0;
  let lastPaintAt = 0;
  let attackUntil = 0;
  let attackWindow = 0;
  let holding = false;
  let pausedAt = 0;

  const stale = (now: number, interval: number): boolean =>
    now - lastFrameAt > Math.max(4 * interval, SETTLE_MS);

  return {
    levels,
    peaks,
    holding: () => holding,
    frameArrived(now) {
      if (!holding) lastFrameAt = now;
    },
    touch(now) {
      lastPaintAt ||= now;
    },
    pause(now, smooth) {
      holding = smooth && (levels.some((level) => level > 0) || peaks.some((peak) => peak > 0));
      pausedAt = now;
    },
    resume(now) {
      if (!holding) return;
      holding = false;
      const gap = now - pausedAt;
      lastFrameAt += gap;
      lastPaintAt += gap;
      for (let index = 0; index < SPECTRUM_BARS; index += 1) {
        peakHeldUntil[index] = (peakHeldUntil[index] ?? 0) + gap;
      }
    },
    release() {
      holding = false;
    },
    soften(now, windowMs) {
      attackWindow = windowMs;
      attackUntil = now + windowMs;
      peakHeldUntil.fill(now);
    },
    step(now, input, smooth) {
      if (holding) return false;
      const settled = stale(now, input.interval);
      // 缓冲本身就是 200 根柱，`groupBands` 逐根照抄。
      if (!input.live || !input.playing || settled || !input.latest) target.fill(0);
      else groupBands(input.latest, target);
      const elapsed = now - lastPaintAt;
      const attack = now < attackUntil ? attackFor(elapsed, attackWindow) : 1;
      const moving = settleBars(levels, target, smooth ? releaseFor(elapsed) : 0, attack);
      const peaksMoving = smooth && settlePeaks(peaks, peakHeldUntil, levels, now, elapsed);
      lastPaintAt = now;
      // 帧还在来就跟着刷新率画；帧停了等柱与峰值点落到目标再停。
      return smooth && (moving || peaksMoving || (input.live && !settled));
    },
  };
}
