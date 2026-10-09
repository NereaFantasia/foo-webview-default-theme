import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  startWindowActivity,
  windowActivityAtom,
  type WindowActivitySource,
  type WindowActivityState,
} from '../../../src/host/windowActivity.ts';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { startWindowShell, windowShellAtom } from '../../../src/host/windowShell.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => vi.useRealTimers());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function browser(visible = true, focused = true) {
  const document = Object.assign(new EventTarget(), {
    hidden: !visible,
    hasFocus: () => focused,
  });
  const window = new EventTarget();
  const source: WindowActivitySource = { document, window };
  return {
    source,
    visible(value: boolean, focus = focused) {
      document.hidden = !value;
      focused = focus;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    focus(value: boolean) {
      focused = value;
      window.dispatchEvent(new Event(value ? 'focus' : 'blur'));
    },
  };
}

function windowState(minimized = false, focused = true) {
  return {
    success: true as const,
    maximized: false,
    minimized,
    fullscreen: false,
    alwaysOnTop: false,
    focused,
    isMaximized: false,
    isMinimized: minimized,
    isFullscreen: false,
    isAlwaysOnTop: false,
    isFocused: focused,
    width: 1280,
    height: 800,
    x: 0,
    y: 0,
  };
}

function notify(host: UnitHost) {
  host.emit('window:stateChanged', {
    windowId: 'other-window',
    isMaximized: false,
    isMinimized: false,
    maximized: false,
    minimized: false,
    isActive: true,
    active: true,
    isFullscreen: false,
    fullscreen: false,
  });
}

function start(host: UnitHost, view = browser()) {
  const store = createStore();
  const shell = startWindowShell(store, host.fb);
  const activity = startWindowActivity(store, shell, view.source);
  onTestFinished(() => {
    activity.dispose();
    shell.dispose();
  });
  return { store, shell, activity, view, state: () => store.get(windowActivityAtom) };
}

describe('startWindowActivity', () => {
  it('首读同步采用浏览器事实；宿主连上但未返回快照时不假定聚焦或未最小化', async () => {
    const host = installFakeHost();
    const held = host.hold('window.getState');
    const { store, shell, state } = start(host, browser(false, false));
    expect(state()).toEqual({ documentVisible: false, minimized: null, focused: false });
    await settle();
    expect(store.get(windowShellAtom).status).toBe('connected');
    expect(state()).toEqual({ documentVisible: false, minimized: null, focused: false });
    held.respond(0, windowState(true, false));
    await shell.ready;
    expect(state()).toEqual({ documentVisible: false, minimized: true, focused: false });
  });

  it('只复用窗口壳的一份订阅，其他窗口事件只触发当前窗口回读', async () => {
    const host = installFakeHost();
    const { shell, state } = start(host);
    await shell.ready;
    expect(host.listenerCount('window:stateChanged')).toBe(1);
    host.answer('window.getState', windowState(true, false));
    notify(host);
    await settle();
    expect(state()).toEqual({ documentVisible: true, minimized: true, focused: false });
    expect(host.callsTo('window.getState')).toEqual([{}, {}]);
  });

  it('已取得有效快照后再启动，首帧直接采用宿主最小化和焦点', async () => {
    const host = installFakeHost();
    host.answer('window.getState', windowState(true, false));
    const store = createStore();
    const shell = startWindowShell(store, host.fb);
    await shell.ready;
    const activity = startWindowActivity(store, shell, browser().source);
    expect(store.get(windowActivityAtom)).toEqual({
      documentVisible: true,
      minimized: true,
      focused: false,
    });
    activity.dispose();
    shell.dispose();
  });

  it('文档隐藏同步发布，不等待宿主回读，也不伪造托盘或最小化原因', async () => {
    const host = installFakeHost();
    const { shell, view, state } = start(host);
    await shell.ready;
    view.visible(false, false);
    expect(state()).toEqual({ documentVisible: false, minimized: false, focused: true });
    expect(host.callsTo('window.getState')).toHaveLength(1);
  });

  it('普通窗口回读失败保留有效快照', async () => {
    const host = installFakeHost();
    host.answer('window.getState', windowState(true, false));
    const { shell, state } = start(host);
    await shell.ready;
    const previous = state();
    host.answer('window.getState', hostFailure('OPERATION_FAILED'));
    notify(host);
    await settle();
    expect(state()).toBe(previous);
  });

  it('恢复可见先同步撤销旧最小化，复核失败后继续采用浏览器事实', async () => {
    const host = installFakeHost();
    host.answer('window.getState', windowState(true, false));
    const { store, shell, view, state } = start(host, browser(false, false));
    await shell.ready;
    const seen: WindowActivityState[] = [];
    const off = store.sub(windowActivityAtom, () => seen.push(state()));
    const held = host.hold('window.getState');
    view.visible(true, true);
    expect(seen).toEqual([{ documentVisible: true, minimized: null, focused: true }]);
    await settle();
    held.respond(0, hostFailure('OPERATION_FAILED'));
    await settle();
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
    expect(seen).toHaveLength(1);
    off();
  });

  it('文档一直可见时，重新聚焦仍能解除过期的宿主最小化判断', async () => {
    const host = installFakeHost();
    host.answer('window.getState', windowState(true, false));
    const { shell, view, state } = start(host, browser(true, false));
    await shell.ready;
    const held = host.hold('window.getState');
    view.focus(true);
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
    await settle();
    held.respond(0, windowState(false, true));
    await settle();
    expect(state()).toEqual({ documentVisible: true, minimized: false, focused: true });
  });

  it('连续恢复信号只采用最后的复核，旧成功应答不能恢复过期的最小化状态', async () => {
    const host = installFakeHost();
    const { shell, view, state } = start(host, browser(false, false));
    await shell.ready;
    const held = host.hold('window.getState');
    view.visible(true, true);
    view.focus(true);
    await settle();
    expect(held.pending).toHaveLength(2);
    held.respond(1, hostFailure('OPERATION_FAILED'));
    await settle();
    held.respond(0, windowState(true, false));
    await settle();
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
  });

  it('等待宿主期间的隐藏与恢复不发调用，宿主就绪后仍正常取得第一份快照', async () => {
    const host = installFakeHost({ available: false });
    const { shell, view, state } = start(host, browser(false, false));
    view.visible(true, true);
    view.focus(true);
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
    expect(host.calls).toEqual([]);
    host.connect();
    await shell.ready;
    expect(state()).toEqual({ documentVisible: true, minimized: false, focused: true });
    expect(host.listenerCount('window:stateChanged')).toBe(1);
  });

  it('没有宿主时仍可用；失焦不等于隐藏，重新聚焦不开始轮询', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const { shell, view, state } = start(host);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await shell.ready;
    view.focus(false);
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: false });
    view.focus(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
    expect(host.calls).toEqual([]);
  });

  it('活动事实未变化时保持同一快照，不因重复事件发布新对象', async () => {
    const host = installFakeHost();
    const { store, shell, view, state } = start(host);
    await shell.ready;
    const previous = state();
    const changed = vi.fn();
    const off = store.sub(windowActivityAtom, changed);
    view.visible(true);
    notify(host);
    await settle();
    expect(state()).toBe(previous);
    expect(changed).not.toHaveBeenCalled();
    off();
  });

  it('窗口壳释放后不再信任旧活动快照', async () => {
    const host = installFakeHost();
    host.answer('window.getState', windowState(true, false));
    const { shell, state } = start(host);
    await shell.ready;
    shell.dispose();
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
  });

  it('释放后撤销 DOM 和 store 监听，晚到应答不再发布活动状态', async () => {
    const host = installFakeHost();
    const view = browser();
    const docRemove = vi.spyOn(view.source.document, 'removeEventListener');
    const windowRemove = vi.spyOn(view.source.window, 'removeEventListener');
    const { shell, activity, state } = start(host, view);
    await shell.ready;
    const held = host.hold('window.getState');
    view.focus(true);
    await settle();
    activity.dispose();
    activity.dispose();
    const previous = state();
    view.visible(false);
    view.focus(false);
    view.focus(true);
    held.respond(0, windowState(true, false));
    await settle();
    expect(state()).toBe(previous);
    expect(docRemove).toHaveBeenCalledTimes(1);
    expect(windowRemove.mock.calls.map(([type]) => type)).toEqual(['focus', 'blur']);
    expect(host.callsTo('window.getState')).toHaveLength(2);
    expect(host.listenerCount('window:stateChanged')).toBe(1);
  });

  it('同一 store 重建时重新读取文档，旧实例重复释放不影响新实例', async () => {
    const host = installFakeHost();
    const { store, shell, activity, view, state } = start(host);
    await shell.ready;
    activity.dispose();
    view.visible(false);
    const next = startWindowActivity(store, shell, view.source);
    activity.dispose();
    expect(state().documentVisible).toBe(false);
    view.visible(true);
    expect(state()).toEqual({ documentVisible: true, minimized: null, focused: true });
    await settle();
    expect(state().minimized).toBe(false);
    next.dispose();
  });

  it('无 DOM 时支持显式空输入与默认输入，不访问浏览器全局或主动请求宿主', () => {
    const store = createStore();
    const shell = { refreshState: vi.fn(async () => {}) };
    const explicit = startWindowActivity(store, shell, null);
    expect(store.get(windowActivityAtom)).toEqual({
      documentVisible: true,
      minimized: null,
      focused: true,
    });
    explicit.dispose();
    const implicit = startWindowActivity(store, shell);
    expect(shell.refreshState).not.toHaveBeenCalled();
    implicit.dispose();
  });
});
