import { progressOf, type Motion } from './canvasMotion.ts';

/**
 * 播放头与罗盘轨道点显示的位置。宿主 100 ms 推一拍位置，直接用会一格一格地走，所以播放中从最近一拍按墙钟往后推，
 * 最多推 `EXTRAPOLATE_MS`。同一首里位置跳了（seek、拖动起手、取消拖动）就从屏幕上此刻的位置滑到新位置，
 * 滑的途中目标照常往前走，到时长末正好追上；滑的途中又跳就从当时的位置重新滑。换曲不滑，直接落到新曲的位置。
 *
 * 跳没跳按「新一拍离外推值多远」判，不看事件来源：来自底条、键盘、别的窗口的 seek 与波形上的 seek 一样处理。
 * `period` 给了时按周期取短的那头滑（轨道点转一圈是一个周期，往回 seek 一分钟不该倒转大半圈）。
 */
export const EXTRAPOLATE_MS = 250;
/**
 * 新一拍离外推值超过这么多秒算跳变。正常一拍的偏差是几十毫秒。宿主只剩按整秒报的 1 Hz 进度时，外推最多推
 * `EXTRAPOLATE_MS`，每拍偏差约 0.75 s，也会判成跳变。
 */
export const JUMP_SECONDS = 0.5;

export interface PositionSample {
  seconds: number;
  /** 宿主时钟在走（在播放、不是拖动中的草稿）：这一拍之后可以按墙钟外推。 */
  live: boolean;
}

/** 这一拍相对上一拍：换了曲、同一首里跳了，或者都不是（`null`）。 */
export type PositionChange = 'track' | 'jump' | null;

export interface PositionGlide {
  /**
   * 喂一拍。`track` 是曲目键，变了算换曲；`motion` 是这一拍若判为跳变时滑的过渡，给 `null` 不起新的滑动
   * （拖动中、减弱动效），正在滑的那一段照旧滑完。
   */
  sample(next: PositionSample, track: string, now: number, motion?: Motion | null): PositionChange;
  /** `now` 时该显示的位置（秒）。 */
  at(now: number): number;
  /** `now` 时还在滑。 */
  gliding(now: number): boolean;
}

interface Anchor extends PositionSample {
  at: number;
  track: string;
}

export function createPositionGlide(period = 0): PositionGlide {
  let anchor: Anchor | null = null;
  let glide: { from: number; start: number; motion: Motion } | null = null;

  const toward = (from: number, target: number): number => {
    const delta = target - from;
    return period > 0 ? delta - period * Math.round(delta / period) : delta;
  };

  function targetAt(now: number): number {
    if (!anchor) return 0;
    if (!anchor.live) return anchor.seconds;
    return anchor.seconds + Math.min(Math.max(now - anchor.at, 0), EXTRAPOLATE_MS) / 1000;
  }

  function at(now: number): number {
    const target = targetAt(now);
    if (!glide) return target;
    const progress = progressOf(glide.motion, glide.start, now);
    if (progress >= 1) {
      glide = null;
      return target;
    }
    return glide.from + toward(glide.from, target) * glide.motion.ease(progress);
  }

  return {
    sample(next, track, now, motion = null) {
      if (!anchor || anchor.track !== track) {
        const change: PositionChange = anchor ? 'track' : null;
        anchor = { ...next, at: now, track };
        glide = null;
        return change;
      }
      const expected = targetAt(now);
      const shown = at(now);
      anchor = { ...next, at: now, track };
      if (Math.abs(next.seconds - expected) <= JUMP_SECONDS) return null;
      if (motion && motion.duration > 0) glide = { from: shown, start: now, motion };
      return 'jump';
    },
    at,
    gliding: (now) => glide !== null && progressOf(glide.motion, glide.start, now) < 1,
  };
}
