import { paintFpsCap } from './frameScheduler.ts';

/**
 * 流动底色的帧率守门：流动开着时逐帧记重画间隔，最近 `window` 帧里慢帧占到 `ratio` 以上，
 * 就判定这台机器扛不住，交给调用方退到静态档。
 *
 * 重画经 `frameScheduler.ts`，缺省跟显示刷新率走（60 Hz 屏一帧约 16.7 ms），间隔超过 `slowMs`
 * （缺省 25 ms，约合 40 fps）记作慢帧。设了重画上限时，慢帧线不低于上限帧距的 1.5 倍（封 30 就是 50 ms），
 * 免得按上限画的每一帧都算慢。
 * 超过 `gapMs` 的间隔不记：那是页面隐藏、窗口拖动之类的停顿，不是渲染慢。开头 `warmup` 帧也不记，
 * 着色器编译、首次上传这些一次性开销都落在那里。
 */
export interface GovernorOptions {
  window: number;
  ratio: number;
  slowMs: number;
  gapMs: number;
  warmup: number;
}

export const GOVERNOR_DEFAULTS: GovernorOptions = {
  window: 90,
  ratio: 0.5,
  slowMs: 25,
  gapMs: 250,
  warmup: 30,
};

export interface FrameGovernor {
  /** 记一帧的间隔（毫秒）；返回 `true` 表示该退档了，之后再调也一直是 `true`。 */
  record(intervalMs: number): boolean;
}

export function createFrameGovernor(options: GovernorOptions = GOVERNOR_DEFAULTS): FrameGovernor {
  const slow: boolean[] = [];
  let slowCount = 0;
  let skipped = 0;
  let tripped = false;
  return {
    record(intervalMs) {
      if (tripped) return true;
      if (intervalMs > options.gapMs) return false;
      if (skipped < options.warmup) {
        skipped += 1;
        return false;
      }
      const cap = paintFpsCap();
      const slowMs = cap === null ? options.slowMs : Math.max(options.slowMs, 1500 / cap);
      const isSlow = intervalMs > slowMs;
      slow.push(isSlow);
      if (isSlow) slowCount += 1;
      if (slow.length > options.window && slow.shift()) slowCount -= 1;
      tripped = slow.length === options.window && slowCount / options.window > options.ratio;
      return tripped;
    },
  };
}
