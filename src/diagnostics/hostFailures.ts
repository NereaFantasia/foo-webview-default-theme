import type { bridge, fb } from 'foo-webview-sdk/bridge';
import { log } from './eventLog.ts';

type MetricsHook = NonNullable<Parameters<typeof bridge.setMetricsHook>[0]>;

/** 慢调用的阈值（毫秒） */
const SLOW_MS = 1000;
/** 本身就需要等待用户或网络的调用，耗时长不说明宿主有问题 */
const SLOW_EXEMPT = /^(?:dialog|http)\./;
/** 调用方已按正常流程处理的失败：方法名对应的错误码。这些失败不写入日志，以免日志被刷满 */
const EXPECTED_CODES: Readonly<Record<string, readonly string[]>> = {
  'file.read': ['NOT_FOUND'],
  'file.list': ['NOT_FOUND'],
  'file.delete': ['NOT_FOUND'],
  // 注册热键前总会先注销一次，清除上一个实例可能残留的登记。没有残留时宿主返回 NOT_FOUND
  'keyboard.unregisterHotkey': ['NOT_FOUND'],
  // 冷启动时窗口尚未绘制，宿主返回 OPERATION_FAILED。主题保留该请求，窗口显示后再应用，
  // 最终状态见报告头部的 Backdrop application 一行
  'window.setBackdropPolicy': ['OPERATION_FAILED'],
  'playlist.getSelection': ['NOT_FOUND'],
  'playlist.getGroupRuns': ['NOT_FOUND'],
  'audio.getSpectrum': ['NOT_FOUND'],
};

function codeOf(value: unknown): string | undefined {
  const code = typeof value === 'object' && value !== null ? Reflect.get(value, 'code') : undefined;
  return typeof code === 'string' && code ? code : undefined;
}

/** 被拒绝的调用的错误码：取 `code`，没有时取错误类名。消息原文含曲目路径与标题，不读取 */
export function rejectionCode(error: unknown): string {
  return codeOf(error) ?? (error instanceof Error ? error.name : typeof error);
}

/**
 * 调用失败时的错误码，未失败时为 null。被拒绝的调用见 `rejectionCode`。
 * `result` 与 `error` 对象含曲目路径与标题，只读取其中的 `success` 与 `code`
 */
function failureCode({ success, result, error }: Parameters<MetricsHook>[0]): string | null {
  if (!success) return rejectionCode(error);
  const failed =
    typeof result === 'object' && result !== null && Reflect.get(result, 'success') === false;
  return failed ? (codeOf(result) ?? 'UNKNOWN') : null;
}

/**
 * 记录宿主调用的失败与慢调用，以及 WebView 进程故障，返回卸载函数。
 * 失败包括被拒绝的调用与 `success: false` 的应答，只记录方法名与错误码。指标钩子只有一个槽位，卸载时清空
 */
export function startHostFailureLog(
  metrics: Pick<typeof bridge, 'setMetricsHook'>,
  host: Pick<typeof fb, 'on'>,
): () => void {
  metrics.setMetricsHook((call) => {
    const code = failureCode(call);
    if (code !== null) {
      if (!EXPECTED_CODES[call.method]?.includes(code))
        log.warn('host', 'call.fail', { method: call.method, code });
    } else if (call.durationMs >= SLOW_MS && !SLOW_EXEMPT.test(call.method)) {
      log.warn('host', 'call.slow', { method: call.method, ms: Math.round(call.durationMs) });
    }
  });
  const off = host.on('webview:processFailed', ({ kind, recovered, recoveryAction }) =>
    (recovered ? log.warn : log.error)('host', 'process.failed', {
      kind,
      recovered,
      action: recoveryAction,
    }),
  );
  return () => {
    metrics.setMetricsHook(undefined);
    off();
  };
}
