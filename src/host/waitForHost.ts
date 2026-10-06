import { fb } from 'foo-webview-sdk/bridge';

/** 主题自己的就绪等待上限：SDK 的 `ready()` 既不超时也不拒绝，不计时就会永远停在等待态。 */
export const READY_TIMEOUT_MS = 5000;

/** 等待就绪只需要这两项，类型取自 SDK 的 `fb`。 */
export interface HostReadyFace {
  isAvailable: typeof fb.isAvailable;
  ready: typeof fb.ready;
}

/**
 * 等宿主就绪：已可用时立即为真，到期未就绪为假。
 * `cancel()` 只清定时器，不取消 `ready()` —— SDK 没有取消口，调用方靠自己的代次丢弃晚到的结果。
 *
 * `ready()` 返回后仍须确认 `isAvailable()`；超时返回 false，不重试或重建 Bridge。
 * 等待结束不会自动清定时器，调用方可用 `cancel()` 清理。
 */
export function waitForHost(host: HostReadyFace): { done: Promise<boolean>; cancel: () => void } {
  if (host.isAvailable()) return { done: Promise.resolve(true), cancel: () => {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = Promise.race([
    host.ready().then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
    }),
    // 只有 ready 先完成且 SDK 已可用才返回 true；超时不再接受随后到达的就绪状态。
  ]).then((arrived) => arrived && host.isAvailable());
  return {
    done,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
