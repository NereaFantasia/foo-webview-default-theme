import { atom, createStore } from 'jotai/vanilla';
import { beforeEach, describe, expect, it } from 'vitest';
import { startRuntimeLogIntegration } from '../../../src/app/runtimeLogIntegration.ts';
import { entries, resetEventLog } from '../../../src/diagnostics/eventLog.ts';
import type { BackendStatus } from '../../../src/update/backendBootstrap.ts';
import type { UpdateStatus } from '../../../src/update/updater.ts';

beforeEach(() => {
  resetEventLog();
});

function start(
  backend: BackendStatus = { phase: 'off' },
  updater: UpdateStatus = { phase: 'off' },
) {
  const store = createStore();
  const backendAtom = atom<BackendStatus>(backend);
  const updaterAtom = atom<UpdateStatus>(updater);
  const stop = startRuntimeLogIntegration(store, {
    backend: { status: backendAtom },
    updater: { status: updaterAtom },
  });
  return {
    stop,
    setBackend: (next: BackendStatus) => store.set(backendAtom, next),
    setUpdater: (next: UpdateStatus) => store.set(updaterAtom, next),
  };
}

const logged = () =>
  entries().map(({ level, tag, event, fields }) => ({ level, tag, event, fields }));

describe('后端与更新的状态迁移', () => {
  it('订阅时的初值不记，哪怕已经是失败', () => {
    start(
      { phase: 'failed', reason: 'prepare', detail: 'x' },
      {
        phase: 'idle',
        checkedAt: null,
        failure: 'tls',
        gaveUp: false,
      },
    );
    expect(entries()).toEqual([]);
  });

  it('后端准备失败与中断记 error，正常阶段不记', () => {
    const { setBackend } = start();
    setBackend({ phase: 'preparing' });
    setBackend({ phase: 'ready', version: '0.3.0', runtime: '22.9.0' });
    expect(entries()).toEqual([]);
    setBackend({ phase: 'failed', reason: 'stopped', detail: '本地后端连接已中断' });
    expect(logged()).toEqual([
      {
        level: 'error',
        tag: 'backend',
        event: 'bootstrap.failed',
        fields: { reason: 'stopped', detail: '本地后端连接已中断' },
      },
    ]);
  });

  it('失败详情里的路径与令牌在写入时去掉', () => {
    const { setBackend } = start();
    setBackend({
      phase: 'failed',
      reason: 'prepare',
      detail: 'EPERM rename C:\\Users\\张三\\node.exe, then token=abc123 rejected',
    });
    const detail = String(entries()[0]?.fields?.['detail']);
    expect(detail).toContain('EPERM rename <path>');
    for (const poison of ['张三', 'C:\\', 'abc123']) expect(detail).not.toContain(poison);
  });

  it('更新检查失败记 warn，带失败类别与是否放弃重试；没失败的空闲不记', () => {
    const { setUpdater } = start();
    setUpdater({ phase: 'checking' });
    setUpdater({ phase: 'idle', checkedAt: 1, failure: null, gaveUp: false });
    expect(entries()).toEqual([]);
    setUpdater({ phase: 'idle', checkedAt: 2, failure: 'tls', gaveUp: true });
    expect(logged()).toEqual([
      {
        level: 'warn',
        tag: 'update',
        event: 'check.failed',
        fields: { failure: 'tls', gaveUp: true },
      },
    ]);
  });

  it('连续相同的检查失败折叠成一条', () => {
    const { setUpdater } = start();
    for (let checkedAt = 1; checkedAt <= 3; checkedAt += 1)
      setUpdater({ phase: 'idle', checkedAt, failure: 'offline', gaveUp: false });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ n: 3 });
  });

  it('更新状态损坏需要手动处理时记一条', () => {
    const { setUpdater } = start();
    setUpdater({ phase: 'manual', reason: 'format' });
    expect(logged()).toEqual([
      { level: 'warn', tag: 'update', event: 'manual', fields: { reason: 'format' } },
    ]);
  });

  it('退订后不再记', () => {
    const { stop, setBackend, setUpdater } = start();
    stop();
    setBackend({ phase: 'failed', reason: 'prepare', detail: 'x' });
    setUpdater({ phase: 'manual', reason: 'format' });
    expect(entries()).toEqual([]);
  });
});
