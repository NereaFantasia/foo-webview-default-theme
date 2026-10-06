import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  startWindowMode,
  windowModeAtom,
  WINDOW_MODE_TIMEOUT_MS,
} from '../../../src/host/windowMode.ts';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { hostFailure, methodNotFound } from '../../fixtures/hostAnswers.ts';

afterEach(() => vi.useRealTimers());

describe('启动窗口模式检查', () => {
  it('确认独立窗口才放行，调用不附带参数', async () => {
    const host = installFakeHost();
    const store = createStore();
    const service = startWindowMode(store, host.fb);
    onTestFinished(service.dispose);
    expect(store.get(windowModeAtom)).toBe('checking');
    await service.ready;
    expect(store.get(windowModeAtom)).toBe('standalone');
    expect(host.callsTo('window.getMode')).toEqual([{}]);
  });

  it.each(['dui', 'cui', 'panel', 'unknown'] as const)('模式为 %s 时只允许说明页', async (mode) => {
    const host = installFakeHost();
    host.answer('window.getMode', { success: true, mode, panelMode: true, windowId: 'panel-1' });
    const store = createStore();
    const service = startWindowMode(store, host.fb, true);
    onTestFinished(service.dispose);
    await service.ready;
    expect(store.get(windowModeAtom)).toBe('panel');
  });

  it('mode 和 panelMode 不一致时也不放行', async () => {
    const host = installFakeHost();
    host.answer('window.getMode', {
      success: true,
      mode: 'standalone',
      panelMode: true,
      windowId: 'panel-1',
    });
    const store = createStore();
    const service = startWindowMode(store, host.fb);
    onTestFinished(service.dispose);
    await service.ready;
    expect(store.get(windowModeAtom)).toBe('panel');
    host.answer('window.getMode', {
      success: true,
      mode: 'unknown',
      panelMode: false,
      windowId: 'main',
    });
    await service.retry();
    expect(store.get(windowModeAtom)).toBe('panel');
  });

  it.each(['envelope', 'reject'] as const)(
    '读取失败（%s）不变成预览，可以显式重试',
    async (failure) => {
      const host = installFakeHost();
      host.answer(
        'window.getMode',
        failure === 'envelope'
          ? hostFailure('OPERATION_FAILED')
          : () => {
              throw methodNotFound('window.getMode');
            },
      );
      const store = createStore();
      const service = startWindowMode(store, host.fb, true);
      onTestFinished(service.dispose);
      await service.ready;
      expect(store.get(windowModeAtom)).toBe('failed');
      host.answer('window.getMode', {
        success: true,
        mode: 'standalone',
        panelMode: false,
        windowId: 'main',
      });
      await service.retry();
      expect(store.get(windowModeAtom)).toBe('standalone');
    },
  );

  it.each([false, true])('等不到宿主时，仅显式允许才预览（%s）', async (allowPreview) => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const service = startWindowMode(store, host.fb, allowPreview);
    onTestFinished(service.dispose);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await service.ready;
    expect(store.get(windowModeAtom)).toBe(allowPreview ? 'preview' : 'failed');
    expect(host.calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('宿主延迟就绪后仍先检查面板，不提前进入预览', async () => {
    const host = installFakeHost({ available: false });
    host.answer('window.getMode', {
      success: true,
      mode: 'dui',
      panelMode: true,
      windowId: 'panel-1',
    });
    const store = createStore();
    const service = startWindowMode(store, host.fb, true);
    onTestFinished(service.dispose);
    expect(store.get(windowModeAtom)).toBe('checking');
    host.connect();
    await service.ready;
    expect(store.get(windowModeAtom)).toBe('panel');
  });

  it('超时后拒收晚到的放行结果，重试以新的应答为准', async () => {
    vi.useFakeTimers();
    const host = installFakeHost();
    const held = host.hold('window.getMode');
    const store = createStore();
    const service = startWindowMode(store, host.fb);
    onTestFinished(service.dispose);
    await vi.advanceTimersByTimeAsync(WINDOW_MODE_TIMEOUT_MS);
    await service.ready;
    expect(store.get(windowModeAtom)).toBe('failed');
    host.answer('window.getMode', {
      success: true,
      mode: 'dui',
      panelMode: true,
      windowId: 'panel-1',
    });
    const retry = service.retry();
    await vi.advanceTimersByTimeAsync(0);
    held.respond(0, { success: true, mode: 'standalone', panelMode: false, windowId: 'main' });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get(windowModeAtom)).toBe('checking');
    held.release();
    await retry;
    expect(store.get(windowModeAtom)).toBe('panel');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('释放会结束未就绪等待，重试不再发布状态', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    const service = startWindowMode(store, host.fb);
    service.dispose();
    await service.ready;
    await service.retry();
    expect(store.get(windowModeAtom)).toBe('checking');
    expect(vi.getTimerCount()).toBe(0);
    host.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.calls).toEqual([]);
  });
});
