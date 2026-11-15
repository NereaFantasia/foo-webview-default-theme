import { bridge } from 'foo-webview-sdk/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entries, reportText, resetEventLog } from '../../../src/diagnostics/eventLog.ts';
import { startHostFailureLog } from '../../../src/diagnostics/hostFailures.ts';
import { hostFailure, methodNotFound } from '../../fixtures/hostAnswers.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

type Hook = Parameters<typeof bridge.setMetricsHook>[0];

beforeEach(() => {
  resetEventLog();
});

/** 手里握着钩子，单测可以直接喂任意的耗时与结果 */
function start() {
  const host = installFakeHost();
  let hook: Hook;
  const stop = startHostFailureLog(
    {
      setMetricsHook(next) {
        hook = next;
      },
    },
    host.fb,
  );
  const settled = (call: {
    method: string;
    durationMs?: number;
    result?: unknown;
    error?: unknown;
    rejected?: boolean;
  }) =>
    hook?.({
      method: call.method,
      durationMs: call.durationMs ?? 5,
      success: !call.rejected,
      ...(call.rejected ? { error: call.error } : { result: call.result }),
    });
  return { host, stop, settled, installed: () => hook !== undefined };
}

const fields = () => entries().map((entry) => ({ event: entry.event, ...entry.fields }));

describe('宿主调用的失败', () => {
  it('失败信封只记方法名与错误码', () => {
    const { settled } = start();
    settled({ method: 'library.getAll', result: hostFailure('NOT_CONFIGURED', '媒体库未启用') });
    expect(entries()[0]).toMatchObject({ level: 'warn', tag: 'host', event: 'call.fail' });
    expect(fields()).toEqual([
      { event: 'call.fail', method: 'library.getAll', code: 'NOT_CONFIGURED' },
    ]);
  });

  it('被拒绝的调用取挂在错误上的 code，没有就取错误类名', () => {
    const { settled } = start();
    settled({ method: 'x.y', rejected: true, error: methodNotFound('x.y') });
    settled({ method: 'x.z', rejected: true, error: new TypeError('boom') });
    settled({ method: 'x.w', rejected: true, error: 'plain' });
    expect(fields()).toEqual([
      { event: 'call.fail', method: 'x.y', code: 'METHOD_NOT_FOUND' },
      { event: 'call.fail', method: 'x.z', code: 'TypeError' },
      { event: 'call.fail', method: 'x.w', code: 'string' },
    ]);
  });

  it('信封没带错误码时记 UNKNOWN', () => {
    const { settled } = start();
    settled({ method: 'x.y', result: { success: false } });
    expect(fields()).toEqual([{ event: 'call.fail', method: 'x.y', code: 'UNKNOWN' }]);
  });

  it('成功的应答不记，也不留 result', () => {
    const { settled } = start();
    settled({ method: 'playback.getState', result: { success: true, title: '晴天' } });
    settled({ method: 'x.y', result: 'not an envelope' });
    settled({ method: 'x.y', result: null });
    expect(entries()).toEqual([]);
  });

  it('调用方已当作正常流程的失败不记，同一方法的其他错误码照记', () => {
    const { settled } = start();
    settled({ method: 'file.read', result: hostFailure('NOT_FOUND') });
    settled({ method: 'file.list', result: hostFailure('NOT_FOUND') });
    settled({ method: 'keyboard.unregisterHotkey', result: hostFailure('NOT_FOUND') });
    settled({ method: 'file.read', result: hostFailure('PERMISSION_DENIED') });
    settled({ method: 'file.exists', result: hostFailure('NOT_FOUND') });
    settled({ method: 'window.setBackdropPolicy', result: hostFailure('OPERATION_FAILED') });
    settled({ method: 'window.setBackdropPolicy', result: hostFailure('INVALID_PARAMS') });
    expect(fields()).toEqual([
      { event: 'call.fail', method: 'file.read', code: 'PERMISSION_DENIED' },
      { event: 'call.fail', method: 'file.exists', code: 'NOT_FOUND' },
      { event: 'call.fail', method: 'window.setBackdropPolicy', code: 'INVALID_PARAMS' },
    ]);
  });

  it('错误消息与应答里的路径、曲名不进报告', () => {
    const { settled } = start();
    settled({
      method: 'file.read',
      result: {
        success: false,
        code: 'IO_ERROR',
        error: '读取 D:\\音乐\\周杰伦\\晴天.flac 失败',
        details: { path: 'D:\\音乐\\周杰伦\\晴天.flac', title: '晴天' },
      },
    });
    settled({
      method: 'file.write',
      rejected: true,
      error: Object.assign(new Error('C:\\Users\\张三\\歌单.m3u 写不进去'), { name: 'IoError' }),
    });
    const text = reportText('header');
    expect(text).toContain('method=file.read code=IO_ERROR');
    expect(text).toContain('method=file.write code=IoError');
    for (const poison of ['晴天', '周杰伦', '张三', '歌单', 'D:\\', 'C:\\']) {
      expect(text).not.toContain(poison);
    }
  });
});

describe('慢调用', () => {
  it('达到一秒才记，记方法名与取整的毫秒数', () => {
    const { settled } = start();
    settled({ method: 'library.getAll', durationMs: 999, result: { success: true } });
    settled({ method: 'library.getAll', durationMs: 1000, result: { success: true } });
    settled({ method: 'library.query', durationMs: 2345.6, result: { success: true } });
    expect(fields()).toEqual([
      { event: 'call.slow', method: 'library.getAll', ms: 1000 },
      { event: 'call.slow', method: 'library.query', ms: 2346 },
    ]);
  });

  it('等用户或网络的调用不算慢', () => {
    const { settled } = start();
    settled({ method: 'dialog.openFile', durationMs: 8000, result: { success: true } });
    settled({ method: 'http.request', durationMs: 5000, result: { success: true } });
    expect(entries()).toEqual([]);
  });

  it('既失败又慢的调用只记失败', () => {
    const { settled } = start();
    settled({ method: 'x.y', durationMs: 30_000, rejected: true, error: new Error('timeout') });
    expect(fields()).toEqual([{ event: 'call.fail', method: 'x.y', code: 'Error' }]);
  });
});

describe('经真实的桥', () => {
  it('宿主答失败信封与拒绝时，钩子收到的东西能被记下', async () => {
    const host = installFakeHost();
    const stop = startHostFailureLog(bridge, host.fb);
    host.answer('file.exists', hostFailure('INVALID_PARAMS'));
    host.answer('file.read', () => {
      throw methodNotFound('file.read');
    });
    await host.fb.file.exists('x');
    await host.fb.file.read('x').catch(() => {});
    stop();
    expect(fields()).toEqual([
      { event: 'call.fail', method: 'file.exists', code: 'INVALID_PARAMS' },
      { event: 'call.fail', method: 'file.read', code: 'METHOD_NOT_FOUND' },
    ]);
  });
});

describe('进程故障', () => {
  const payload = {
    kind: 'renderProcessExited',
    kindRaw: 1,
    recovered: true,
    recoveryAction: 'reload',
  } as const;

  it('恢复了记 warn，没恢复记 error', () => {
    const { host } = start();
    host.emit('webview:processFailed', payload);
    host.emit('webview:processFailed', {
      ...payload,
      kind: 'browserProcessExited',
      recovered: false,
      recoveryAction: 'needRebuild',
    });
    expect(entries().map((entry) => [entry.level, entry.tag, entry.event])).toEqual([
      ['warn', 'host', 'process.failed'],
      ['error', 'host', 'process.failed'],
    ]);
    expect(fields()).toEqual([
      { event: 'process.failed', kind: 'renderProcessExited', recovered: true, action: 'reload' },
      {
        event: 'process.failed',
        kind: 'browserProcessExited',
        recovered: false,
        action: 'needRebuild',
      },
    ]);
  });
});

describe('卸载', () => {
  it('清空钩子并退订事件', () => {
    const { host, stop, installed } = start();
    expect(installed()).toBe(true);
    expect(host.listenerCount('webview:processFailed')).toBe(1);
    stop();
    expect(installed()).toBe(false);
    expect(host.listenerCount('webview:processFailed')).toBe(0);
  });

  it('真实的桥上卸载后不再记', async () => {
    const host = installFakeHost();
    const spy = vi.spyOn(bridge, 'setMetricsHook');
    const stop = startHostFailureLog(bridge, host.fb);
    stop();
    expect(spy).toHaveBeenLastCalledWith(undefined);
    host.answer('file.exists', hostFailure('INVALID_PARAMS'));
    await host.fb.file.exists('x');
    expect(entries()).toEqual([]);
    spy.mockRestore();
  });
});
