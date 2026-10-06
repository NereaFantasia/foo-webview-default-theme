/**
 * 滚轮事件换算成步数，往上滚为正。音量件共用；每处件各持一个换算器，零头不串到别处。
 *
 * 阈值按 Chromium 在 Windows 上的换算取：每行 100/3 像素，系统缺省三行即一格 100 像素。鼠标一格不论系统
 * 设成几行都记一步（一次事件里合并了几格就按 100 像素一格折算）；触控板一次只报不到一行，累积满一格才记一步，
 * 方向反过来或停顿超过 `WHEEL_IDLE_MS` 就把零头清掉。不这样换算的话，触控板轻轻一扫就是几十个事件、几十步。
 */
const LINE_PX = 100 / 3;
const NOTCH_PX = 100;
/** 两次滚轮事件隔得比这久，就当新的一次滚动，毫秒。 */
export const WHEEL_IDLE_MS = 400;

/** 换算要用的三项，React 与 DOM 的 `WheelEvent` 都有。 */
export interface WheelInput {
  readonly deltaY: number;
  /** 0 像素、1 行、2 页，同 `WheelEvent.deltaMode`。 */
  readonly deltaMode: number;
  /** 事件的时刻，毫秒。 */
  readonly timeStamp: number;
}

export type WheelStepper = (event: WheelInput) => number;

export function createWheelStepper(): WheelStepper {
  let carry = 0;
  let lastTime = Number.NEGATIVE_INFINITY;
  return (event) => {
    const px =
      event.deltaMode === 1
        ? event.deltaY * LINE_PX
        : event.deltaMode === 2
          ? Math.sign(event.deltaY) * NOTCH_PX
          : event.deltaY;
    const idle = event.timeStamp - lastTime > WHEEL_IDLE_MS;
    lastTime = event.timeStamp;
    if (px === 0) return 0;
    if (idle || Math.sign(px) !== Math.sign(carry)) carry = 0;
    if (Math.abs(px) >= LINE_PX) {
      carry = 0;
      return -Math.sign(px) * Math.max(1, Math.round(Math.abs(px) / NOTCH_PX));
    }
    carry += px;
    const steps = Math.trunc(carry / NOTCH_PX);
    carry -= steps * NOTCH_PX;
    return steps === 0 ? 0 : -steps;
  };
}
