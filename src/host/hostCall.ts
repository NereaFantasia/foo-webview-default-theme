/**
 * 宿主不认的方法：宿主比主题旧，没有这个方法。收听者拿到方法名（`namespace.method`），认不出时为 null。
 * 只收方法名，不收宿主的原文。
 */
export type MissingMethodListener = (method: string | null) => void;

const missingMethodListeners = new Set<MissingMethodListener>();

/** 登记一个收听者，返回摘掉它的函数。登记之前已经答完的调用不补报。 */
export function onMissingMethod(listener: MissingMethodListener): () => void {
  missingMethodListeners.add(listener);
  return () => {
    missingMethodListeners.delete(listener);
  };
}

/** 宿主报的原文是「Method not found: <方法名>」（插件 `src/api/BridgeCore.cpp` 的 `BridgeCore::HandleMessage`）。 */
const MISSING_METHOD_TEXT = /^Method not found: ([A-Za-z]\w*\.[A-Za-z]\w*)$/;

/**
 * 宿主不认的方法走框架级错误那一路：注入脚本 reject 一个 `code` 为 METHOD_NOT_FOUND 的 Error（插件
 * `src/webview/WebViewHost.cpp` 注入脚本的 `_handleResponse`）。SDK 的失败码里也列了它，失败信封带
 * 这个码时一样认。不是这个码答 undefined。
 */
function missingMethodOf(outcome: unknown): string | null | undefined {
  if (typeof outcome !== 'object' || outcome === null) return undefined;
  if (Reflect.get(outcome, 'code') !== 'METHOD_NOT_FOUND') return undefined;
  const text: unknown = outcome instanceof Error ? outcome.message : Reflect.get(outcome, 'error');
  return (typeof text === 'string' && MISSING_METHOD_TEXT.exec(text)?.[1]) || null;
}

function reportMissingMethod(outcome: unknown): void {
  if (missingMethodListeners.size === 0) return;
  const method = missingMethodOf(outcome);
  if (method === undefined) return;
  for (const listener of [...missingMethodListeners]) {
    try {
      listener(method);
    } catch (error) {
      // 收听者出错不能让 settle 拒绝：改到下一个微任务里抛，照样进控制台。
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

/**
 * 跑一次宿主调用，reject 收成 null。
 *
 * 宿主调用失败有两条路：声明过的失败 resolve 成 `success: false` 的信封，原样交回，由调用方按
 * `success` 收窄，宿主不在时 SDK 答的 `NOT_SUPPORTED` 也走这一路；框架级错误（子框架里调用、
 * 30 s 超时、通道断开、宿主不认这个方法）才 reject。宿主不认的方法另报给 `onMissingMethod` 的收听者。
 */
export async function settle<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    const answer = await call();
    reportMissingMethod(answer);
    return answer;
  } catch (reason) {
    reportMissingMethod(reason);
    return null;
  }
}

/** 跑一条只看成败的宿主命令：拿到 `success: true` 才为真。失败怎么提示归调用方。 */
export async function hostCommand(call: () => Promise<{ success: boolean }>): Promise<boolean> {
  return (await settle(call))?.success === true;
}
