/**
 * 沉浸视图各块 canvas 共用的帧调度：`requestAnimationFrame` 合并同一刷新周期内的多次重画请求，
 * 有上限时再挡掉多余的刷新周期。沉浸视图的 canvas 件（山脊图、频谱柱与以后新加的）都经这里重画，
 * 不自己调 `requestAnimationFrame`。
 *
 * 重画缺省不封顶，跟显示器刷新率走：各件都按经过的时间推进画面（山脊图在两帧数据之间滑动、柱按时间回落、
 * 声场按时刻逐帧放样本），画得越密越顺，速度不变。上限由 `setPaintFpsCap` 设。
 *
 * 取数循环（频谱拉取、声场轮询）不跟刷新率走，建调度时给固定上限 `DATA_FPS`：山脊图每拉到一帧推一行，
 * 取得越密滚得越快、能留的历史越短，宿主的调用次数也跟着涨。
 *
 * 动得慢的 canvas 可以给自己再设一道上限，与重画上限取小：一帧挪不到一个像素的画面多画也看不出，
 * 而页面上只要还有一块 canvas 每个刷新周期都在变，合成器就得每个周期出一帧，这份开销整页共摊。
 *
 * 封顶按截止时刻而不是「距上次够不够一帧」：后者在 144 Hz 屏上封 60 只能隔两帧画一次、落到 48 fps；
 * 按截止时刻推进，两帧、三帧交替，平均正好是上限。
 */
/** 取数循环的上限（fps）。 */
export const DATA_FPS = 60;
/** rAF 时间戳本身有抖动，60 Hz 屏上相邻两次可能差 16.5 ms；留 1 ms 余量，免得反而隔帧才画。 */
const JITTER_MS = 1;

let paintCap: number | null = null;

/**
 * 设重画的帧率上限；`null`、非有限数或不大于 0 都是不封顶。不必重建调度：下一次画时按新上限算，
 * 只是调高上限时要先走完按旧上限排好的那个截止时刻。
 */
export function setPaintFpsCap(fps: number | null): void {
  paintCap = fps !== null && Number.isFinite(fps) && fps > 0 ? fps : null;
}

/** 当前的重画上限；`null` 为不封顶。 */
export function paintFpsCap(): number | null {
  return paintCap;
}

export interface FrameClock {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface FrameScheduler {
  /** 排一次重画；已经排着就不重复排。 */
  schedule(): void;
  /** 撤掉排着的那一次（卸载时调）。 */
  cancel(): void;
}

/** 调度的帧率上限（fps），两项都不给就跟 `paintFpsCap()` 走。 */
export interface FrameLimit {
  /** 固定上限，不随重画上限变：取数循环用。给了就不看 `max`。 */
  fixed?: number;
  /** 这块 canvas 自己的上限，与重画上限取小：动得慢、一帧挪不到一个像素的 canvas 用。 */
  max?: number;
}

function limitOf(limit: FrameLimit): number | null {
  if (limit.fixed !== undefined) return limit.fixed;
  if (limit.max === undefined) return paintCap;
  return paintCap === null ? limit.max : Math.min(limit.max, paintCap);
}

/** `paint` 收到的是那一帧的 rAF 时间戳。 */
export function createFrameScheduler(
  paint: (now: number) => void,
  clock: FrameClock = browserClock,
  limit: FrameLimit = {},
): FrameScheduler {
  let handle: number | undefined;
  let deadline = Number.NEGATIVE_INFINITY;

  function tick(now: number): void {
    handle = undefined;
    const fps = limitOf(limit);
    if (fps === null) {
      // 不记截止时刻：之后换成有上限时从那一拍重新数。
      deadline = Number.NEGATIVE_INFINITY;
      paint(now);
      return;
    }
    const frameMs = 1000 / fps;
    if (now < deadline - JITTER_MS) {
      handle = clock.request(tick);
      return;
    }
    // 停画过一阵（截止时刻早已过去）就从现在重新数，不补画欠下的帧。
    deadline = now - deadline > frameMs ? now + frameMs : deadline + frameMs;
    paint(now);
  }

  return {
    schedule() {
      if (handle === undefined) handle = clock.request(tick);
    },
    cancel() {
      if (handle !== undefined) clock.cancel(handle);
      handle = undefined;
    },
  };
}
