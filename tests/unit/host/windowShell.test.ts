import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READY_TIMEOUT_MS } from '../../../src/host/waitForHost.ts';
import { startWindowShell, windowShellAtom } from '../../../src/host/windowShell.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function windowState(maximized: boolean, focused = true) {
  return {
    success: true as const,
    maximized,
    minimized: false,
    fullscreen: false,
    alwaysOnTop: false,
    focused,
    isMaximized: maximized,
    isMinimized: false,
    isFullscreen: false,
    isAlwaysOnTop: false,
    isFocused: focused,
    width: 1280,
    height: 800,
    x: 0,
    y: 0,
  };
}

async function start(host: UnitHost, ratio = 1) {
  const store = createStore();
  const shell = startWindowShell(store, host.fb, () => ratio);
  return { store, shell, state: () => store.get(windowShellAtom) };
}

describe('startWindowShell', () => {
  it('先订阅再初读；状态事件只当重读信号，不信它的载荷', async () => {
    const host = installFakeHost();
    let subscribed = -1;
    host.answer('window.getState', () => {
      subscribed = host.listenerCount('window:stateChanged');
      return windowState(false);
    });
    const { shell, state } = await start(host);
    await shell.ready;
    expect(subscribed).toBe(1);
    expect(state()).toMatchObject({ status: 'connected', maximized: false, active: true });

    host.answer('window.getState', windowState(true, false));
    // 载荷说的是另一个窗口也有可能，照样重读自己的。
    host.emit('window:stateChanged', {
      windowId: 'popup-1',
      isMaximized: false,
      isMinimized: false,
      maximized: false,
      minimized: false,
      isActive: true,
      active: true,
      isFullscreen: false,
      fullscreen: false,
    });
    await settle();
    expect(state()).toMatchObject({ maximized: true, active: false });
  });

  it('命令不做乐观更新，执行后回读；失败也回读', async () => {
    const host = installFakeHost();
    const { shell, state } = await start(host);
    await shell.ready;
    host.answer('window.getState', windowState(true));
    await shell.toggleMaximize();
    expect(host.callsTo('window.toggleMaximize')).toEqual([{}]);
    expect(state().maximized).toBe(true);

    host.answer('window.minimize', hostFailure('OPERATION_FAILED'));
    const reads = host.callsTo('window.getState').length;
    await shell.minimize();
    expect(host.callsTo('window.getState').length).toBe(reads + 1);
  });

  it('标题栏高度按物理像素发：越界先挡，同值不重发，DPI 变了补发', async () => {
    const host = installFakeHost();
    let ratio = 1.5;
    const store = createStore();
    const shell = startWindowShell(store, host.fb, () => ratio);
    shell.setTitlebarHeight(48);
    await shell.ready;
    await settle();
    expect(host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 72 }]);

    shell.setTitlebarHeight(48);
    shell.setTitlebarHeight(80);
    await settle();
    // 80 × 1.5 = 120，超过宿主的上限 100，不发。
    expect(host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 72 }]);

    shell.setTitlebarHeight(48);
    ratio = 2;
    host.emit('window:dpiChanged', {
      dpi: 192,
      dpiScale: 2,
      titlebarHeight: 64,
      captionButtonWidth: 92,
      captionButtonsWidth: 276,
    });
    await settle();
    expect(host.callsTo('window.setTitlebarHeight')).toEqual([{ height: 72 }, { height: 96 }]);
  });

  it('宿主拒收的高度下次再发', async () => {
    const host = installFakeHost();
    host.answer('window.setTitlebarHeight', hostFailure('INVALID_PARAMS'));
    const { shell } = await start(host);
    await shell.ready;
    shell.setTitlebarHeight(48);
    await settle();
    shell.setTitlebarHeight(48);
    await settle();
    expect(host.callsTo('window.setTitlebarHeight')).toHaveLength(2);
  });

  it('最大化键的矩形：连上前报的等连上再发，取整后同值不重发，布局变了重发', async () => {
    const host = installFakeHost();
    host.answer('window.setMaximizeButtonRegion', {
      success: true,
      hasRegion: true,
      snapLayouts: true,
      scale: 1.5,
    });
    const store = createStore();
    const shell = startWindowShell(store, host.fb, () => 1.5);
    shell.setMaximizeButtonRegion({ x: 1188.4, y: 0, width: 46, height: 56.6 });
    await shell.ready;
    await settle();
    expect(host.callsTo('window.setMaximizeButtonRegion')).toEqual([
      { region: { x: 1188, y: 0, width: 46, height: 56 } },
    ]);
    expect(store.get(windowShellAtom).snapLayouts).toBe(true);

    shell.setMaximizeButtonRegion({ x: 1188.9, y: 0, width: 46, height: 56 });
    await settle();
    expect(host.callsTo('window.setMaximizeButtonRegion')).toHaveLength(1);

    // 窄窗标题栏 48 高，键跟着变矮。
    shell.setMaximizeButtonRegion({ x: 1188, y: 0, width: 46, height: 48 });
    await settle();
    expect(host.callsTo('window.setMaximizeButtonRegion')).toEqual([
      { region: { x: 1188, y: 0, width: 46, height: 56 } },
      { region: { x: 1188, y: 0, width: 46, height: 48 } },
    ]);
  });

  it('贴靠布局只看最后发出的那次应答；空矩形不算有贴靠布局', async () => {
    const host = installFakeHost();
    const held = host.hold('window.setMaximizeButtonRegion');
    const { shell, state } = await start(host);
    await shell.ready;
    shell.setMaximizeButtonRegion({ x: 900, y: 0, width: 46, height: 56 });
    shell.setMaximizeButtonRegion({ x: 0, y: 0, width: 0, height: 0 });
    await settle();
    expect(held.pending).toHaveLength(2);
    held.respond(1, { success: true, hasRegion: false, snapLayouts: true, scale: 1 });
    await settle();
    // 先发的那次晚到，不能把状态改回有贴靠布局。
    held.respond(0, { success: true, hasRegion: true, snapLayouts: true, scale: 1 });
    await settle();
    expect(state().snapLayouts).toBe(false);
  });

  it('宿主拒收的矩形不再重发，矩形变了才再试；DPI 变了宿主忘掉矩形，照原样补报', async () => {
    const host = installFakeHost();
    host.answer('window.setMaximizeButtonRegion', hostFailure('NOT_SUPPORTED'));
    const { shell, state } = await start(host);
    await shell.ready;
    const rect = { x: 1188, y: 0, width: 46, height: 56 };
    shell.setMaximizeButtonRegion(rect);
    await settle();
    shell.setMaximizeButtonRegion(rect);
    shell.setMaximizeButtonRegion(rect);
    await settle();
    expect(host.callsTo('window.setMaximizeButtonRegion')).toHaveLength(1);
    expect(state().snapLayouts).toBe(false);

    shell.setMaximizeButtonRegion({ ...rect, x: 954 });
    await settle();
    expect(host.callsTo('window.setMaximizeButtonRegion')).toHaveLength(2);

    host.answer('window.setMaximizeButtonRegion', {
      success: true,
      hasRegion: true,
      snapLayouts: true,
      scale: 2,
    });
    host.emit('window:dpiChanged', {
      dpi: 192,
      dpiScale: 2,
      titlebarHeight: 64,
      captionButtonWidth: 92,
      captionButtonsWidth: 276,
    });
    await settle();
    expect(host.callsTo('window.setMaximizeButtonRegion').at(-1)).toEqual({
      region: { ...rect, x: 954 },
    });
    expect(state().snapLayouts).toBe(true);
  });

  it('等不到宿主时停在未连接，三大键不发命令', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const { shell, state } = await start(host);
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await shell.ready;
    expect(state().status).toBe('disconnected');
    await shell.close();
    expect(host.calls).toEqual([]);
  });
});
