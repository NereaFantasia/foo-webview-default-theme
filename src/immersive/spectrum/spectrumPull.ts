import type { fb } from 'foo-webview-sdk/bridge';
import { DATA_FPS, createFrameScheduler, type FrameClock } from '../frame/frameScheduler.ts';

/**
 * 频谱拉取循环：跟着帧调度（按取数上限 `DATA_FPS` 封顶，不跟重画上限走）每拍问宿主一次 `getSpectrum`，
 * 宿主按调用那一刻的播放位置当场算一帧。前一次还没回就跳过这一拍，页面忙时拉取自己变慢、不积压。
 *
 * 只把新帧交出去，新帧按「状态 + `streamTime`」判定：暂停、停止时宿主回静音帧并沿用上一帧的
 * `streamTime`，静音帧因此只交一次，与推送时「离开播放只发一帧静音」一致。应答不在播放或调用失败时，
 * 下一次拉取放宽到 `IDLE_PULL_MS`，恢复播放最多晚这么久被发现。宿主答订阅不存在（被别处退订）就停拉，
 * 此后不再有帧，由调用方按安静处理。
 */
export type SpectrumAnswer = Awaited<ReturnType<typeof fb.audio.getSpectrum>>;

/** 上一次应答不在播放（暂停、停止）或调用失败时，隔这么久（毫秒）再拉。 */
export const IDLE_PULL_MS = 100;
/** rAF 时间戳本身有抖动：按间隔限频时留 1 ms 余量，免得反而隔一拍才拉。 */
const PULL_JITTER_MS = 1;
/** 帧调度的上限；拉取间隔不长于它时不另外按时刻挡。 */
const SCHEDULER_FRAME_MS = 1000 / DATA_FPS;

/** 判新帧用的键：状态加 `streamTime`。帧里没有 `streamTime` 时给 `null`，一律当新帧。 */
export function frameKeyOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('streamTime' in payload)) return null;
  const time = payload.streamTime;
  if (typeof time !== 'number') return null;
  const state = 'state' in payload && typeof payload.state === 'string' ? payload.state : '';
  return `${state}|${time}`;
}

export interface SpectrumPullOptions {
  /** 问一次宿主；调用方把订阅号绑在里面。reject 按调用失败处理。 */
  fetch: () => Promise<SpectrumAnswer>;
  /** 在播时相邻两次拉取的最短间隔（毫秒）。 */
  intervalMs: number;
  onFrame: (answer: SpectrumAnswer) => void;
  clock?: FrameClock;
}

/** 开始拉取；`stop` 之后不再拉，在途的应答回来也不交。 */
export function startSpectrumPull(options: SpectrumPullOptions): { stop(): void } {
  const gated = options.intervalMs > SCHEDULER_FRAME_MS;
  let stopped = false;
  let inFlight = false;
  let nextPullAt = Number.NEGATIVE_INFINITY;
  let lastKey: string | null = null;
  const scheduler = createFrameScheduler(tick, options.clock, { fixed: DATA_FPS });

  function stop(): void {
    stopped = true;
    scheduler.cancel();
  }

  function onAnswer(answer: SpectrumAnswer, sentAt: number): void {
    if (answer.success !== true) {
      if (answer.code === 'NOT_FOUND') {
        stop();
        return;
      }
      nextPullAt = sentAt + IDLE_PULL_MS;
      return;
    }
    if (answer.state !== 'playing') nextPullAt = sentAt + IDLE_PULL_MS;
    const key = frameKeyOf(answer);
    if (key !== null && key === lastKey) return;
    lastKey = key;
    options.onFrame(answer);
  }

  function tick(at: number): void {
    if (stopped) return;
    scheduler.schedule();
    if (inFlight || at < nextPullAt - PULL_JITTER_MS) return;
    inFlight = true;
    nextPullAt = gated ? at + options.intervalMs : Number.NEGATIVE_INFINITY;
    void options.fetch().then(
      (answer) => {
        if (stopped) return;
        inFlight = false;
        onAnswer(answer, at);
      },
      () => {
        if (stopped) return;
        inFlight = false;
        nextPullAt = at + IDLE_PULL_MS;
      },
    );
  }

  scheduler.schedule();
  return { stop };
}
