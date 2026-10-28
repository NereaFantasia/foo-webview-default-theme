/**
 * 宿主未实现方法的回调监听器（通常发生于插件版本低于当前主题要求）
 * 回调参数为标准化方法名（`namespace.method`）；若无法解析原始错误则传入 null
 */
export type MissingMethodListener = (method: string | null) => void;

const missingMethodListeners = new Set<MissingMethodListener>();

/** 注册宿主未实现方法的全局监听器，返回注销函数。注册前已完成的历史调用不补发 */
export function onMissingMethod(listener: MissingMethodListener): () => void {
  missingMethodListeners.add(listener);
  return () => {
    missingMethodListeners.delete(listener);
  };
}

/** 宿主原生未实现错误文本模式（如「Method not found: <方法名>」） */
const MISSING_METHOD_TEXT = /^Method not found: ([A-Za-z]\w*\.[A-Za-z]\w*)$/;

/**
 * 从调用结果或异常中提取宿主未实现的方法名
 * 兼容框架层注入脚本拒绝的 METHOD_NOT_FOUND 异常，以及 SDK 封装的同类型错误码；非该类型错误返回 undefined
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
      // 监听器异常不中断主调用执行：移至微任务队列抛出以记入控制台
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

/** 宿主调用失败详情：包含错误原文 `text` 与信封错误码 `code`（未提供时为 null） */
export interface HostCallFailure {
  readonly text: string;
  readonly code: string | null;
}

/** `settleDetailed` 的执行结果：成功时返回数据 `answer`，失败时返回诊断信息 `failure` */
export type SettledAnswer<T> =
  | { readonly answer: T; readonly failure: null }
  | { readonly answer: null; readonly failure: HostCallFailure };

/** 界面展示用错误文本最大字符数限制，避免异常输出失控溢出 */
const FAILURE_TEXT_LIMIT = 200;

function failureOf(reason: unknown): HostCallFailure {
  const text = (reason instanceof Error ? reason.message : String(reason)).trim();
  let code: string | null = null;
  if (typeof reason === 'object' && reason !== null) {
    // 优先提取 ApiCallError 或 HTTP 错误响应体挂载的 code 属性；若均无显式错误码则回退依赖原始文本
    const direct = Reflect.get(reason, 'code');
    if (typeof direct === 'string' && direct) code = direct;
    else {
      const response = Reflect.get(reason, 'response');
      const nested =
        response !== null && typeof response === 'object'
          ? Reflect.get(response, 'code')
          : undefined;
      if (typeof nested === 'string' && nested) code = nested;
    }
  }
  return {
    text: text.length > FAILURE_TEXT_LIMIT ? `${text.slice(0, FAILURE_TEXT_LIMIT)}…` : text,
    code,
  };
}

/**
 * 执行异步宿主调用并捕获异常，同时提取失败错误码与原文供诊断使用
 * 自动识别并分发未实现方法事件
 */
export async function settleDetailed<T>(call: () => Promise<T>): Promise<SettledAnswer<T>> {
  try {
    const answer = await call();
    reportMissingMethod(answer);
    return { answer, failure: null };
  } catch (reason) {
    reportMissingMethod(reason);
    return { answer: null, failure: failureOf(reason) };
  }
}

/**
 * 执行异步宿主调用并在框架级异常（超时、断开、未实现等）时安全收窄返回 null
 *
 * 宿主调用结果分为两类：
 * - 声明过的业务失败正常 resolve 为 `{ success: false }` 信封，由调用方通过 `success` 判定；
 * - 框架级异常（30 秒超时、通道断开、方法未找到等）进入 reject，由本函数收窄为 null，未实现方法同步派发至 `onMissingMethod`
 */
export async function settle<T>(call: () => Promise<T>): Promise<T | null> {
  return (await settleDetailed(call)).answer;
}

/** 执行简单的无参宿主命令，仅当返回 `{ success: true }` 时判定为成功。错误展示由调用方处理 */
export async function hostCommand(call: () => Promise<{ success: boolean }>): Promise<boolean> {
  return (await settle(call))?.success === true;
}
