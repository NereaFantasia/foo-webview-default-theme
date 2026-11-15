import { log, type LogFields } from './eventLog.ts';

// 栈里的第一处脚本位置；只取路径，来源与查询串不进日志
const FRAME = /(https?:\/\/[^\s)]+?):(\d+):(\d+)/;

// 一帧里布局没收敛时浏览器发的 error 事件，只有文字、没有 error 对象，正常操作就会触发，不是异常
const LAYOUT_NOTICE = /^ResizeObserver loop /;

/** 引号里常是数据片段（如解析 JSON 失败时带出的原文），整体换成省略号 */
const withoutQuoted = (text: string) => text.replace(/(["'`])(?:(?!\1)[^\n])*\1/g, '$1…$1');

function describe(reason: unknown): LogFields {
  const error = reason instanceof Error ? reason : null;
  const frame = error?.stack ? FRAME.exec(error.stack) : null;
  const message = withoutQuoted(error ? error.message : String(reason));
  return {
    name: error ? error.name : typeof reason,
    ...(message ? { message } : {}),
    ...(frame
      ? {
          file: new URL(frame[1]!).pathname.replace(/^\//, ''),
          line: Number(frame[2]),
          col: Number(frame[3]),
        }
      : {}),
  };
}

/** 记一条 error 级事件：只留名称、去掉引号内容后的消息与脚本位置，不留异常对象 */
export function recordError(event: string, reason: unknown): void {
  log.error('error', event, describe(reason));
}

/**
 * 装上全局错误与未处理拒绝的监听，返回卸载函数。React 根的未捕获错误默认经 `reportError` 走到 `error`
 * 事件，不需要另接回调
 */
export function installGlobalErrors(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onError = (event: Event) => {
    const reason = Reflect.get(event, 'error') ?? Reflect.get(event, 'message');
    if (typeof reason === 'string' && LAYOUT_NOTICE.test(reason)) return;
    recordError('uncaught', reason);
  };
  const onRejection = (event: Event) =>
    recordError('unhandledrejection', Reflect.get(event, 'reason'));
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
