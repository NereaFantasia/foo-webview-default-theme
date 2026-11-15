// 快速滚动的监视：页面上任何滚动容器滚得快，就报「快」；慢下来或停下，报「不快」。封面服务据此在快速滚动时
// 暂扣新封面的加载：宿主取图是串行队列，滚走的图块撤销了请求，宿主仍把排上的处理完，进视口的封面要排在它们
// 后面。scroll 不冒泡，所以在文档上用捕获监听，各容器各自记上次的位置与时间

/** 判为快速滚动的速度，像素每毫秒；慢于它是正常浏览，封面照常加载 */
export const FAST_SCROLL_SPEED = 1.2;
/** 快速滚动里速度降到这个以下就算慢下来，比 `FAST_SCROLL_SPEED` 低，免得在门槛附近来回跳 */
const SLOWED_SPEED = 0.6;
/** 没有新的 scroll 事件多久算停下，毫秒 */
export const SCROLL_IDLE_MS = 120;

interface Sample {
  readonly top: number;
  readonly at: number;
}

export interface ScrollEvents {
  addEventListener(
    type: 'scroll',
    listener: (event: Event) => void,
    options: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: 'scroll',
    listener: (event: Event) => void,
    options: EventListenerOptions,
  ): void;
}

/** 事件源是元素取它的 scrollTop，是文档本身（视口滚动）取文档的滚动元素 */
function topOf(target: EventTarget | null): number | null {
  if (target instanceof Element) return target.scrollTop;
  if (target instanceof Document) return target.scrollingElement?.scrollTop ?? 0;
  return null;
}

/**
 * 监视 `source` 上所有滚动容器的纵向速度。`onChange(true)` 在速度达到 `FAST_SCROLL_SPEED` 时报一次，
 * `onChange(false)` 在速度降到 `SLOWED_SPEED` 以下、或 `SCROLL_IDLE_MS` 内没有新事件时报一次。答停止监视的函数，
 * 停止时还在「快」就先报「不快」。`now` 取毫秒时间，缺省用 `performance.now`
 */
export function watchFastScroll(
  source: ScrollEvents,
  onChange: (fast: boolean) => void,
  now: () => number = () => performance.now(),
): () => void {
  const samples = new WeakMap<object, Sample>();
  let fast = false;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const set = (next: boolean) => {
    if (next === fast) return;
    fast = next;
    onChange(fast);
  };

  const listener = (event: Event) => {
    const top = topOf(event.target);
    if (top === null || event.target === null) return;
    const at = now();
    const before = samples.get(event.target);
    samples.set(event.target, { top, at });
    if (before && at - before.at <= SCROLL_IDLE_MS) {
      const speed = Math.abs(top - before.top) / Math.max(at - before.at, 1);
      if (speed >= FAST_SCROLL_SPEED) set(true);
      else if (speed < SLOWED_SPEED) set(false);
    }
    clearTimeout(idle);
    idle = setTimeout(() => set(false), SCROLL_IDLE_MS);
  };

  const options = { capture: true, passive: true };
  source.addEventListener('scroll', listener, options);
  return () => {
    source.removeEventListener('scroll', listener, options);
    clearTimeout(idle);
    set(false);
  };
}
