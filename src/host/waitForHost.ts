import { fb } from 'foo-webview-sdk/bridge';

/** 等待宿主 Bridge 就绪的超时上限（毫秒，默认 5000 ms）。防止 SDK 在不可达环境下无限挂起 */
export const READY_TIMEOUT_MS = 5000;

/** 宿主就绪检测所需的基础接口（源自 SDK 的 `fb` 命名空间） */
export interface HostReadyFace {
  isAvailable: typeof fb.isAvailable;
  ready: typeof fb.ready;
}

/**
 * 等待宿主 Bridge 环境就绪
 * 若当前已就绪立即返回 true；若等待超时则判定为 false
 * - `ready()` 兑现后仍需复核 `isAvailable()` 状态；
 * - `cancel()` 仅清理内部超时定时器，调用方应结合自身代数标志作废晚到的异步结果
 */
export function waitForHost(host: HostReadyFace): { done: Promise<boolean>; cancel: () => void } {
  if (host.isAvailable()) return { done: Promise.resolve(true), cancel: () => {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = Promise.race([
    host.ready().then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
    }),
    // 只有 ready 先完成且 SDK 已可用才返回 true；超时不再接受随后到达的就绪状态
  ]).then((arrived) => arrived && host.isAvailable());
  return {
    done,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
