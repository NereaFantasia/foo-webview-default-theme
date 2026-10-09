import { createStore, type Atom } from 'jotai/vanilla';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startImmersiveIntegration } from '../../../src/app/immersiveIntegration.ts';
import { initializeImmersivePrefs } from '../../../src/app/immersivePrefs.ts';
import { miniWindowAtom } from '../../../src/host/miniWindow.ts';
import { startWindowActivity } from '../../../src/host/windowActivity.ts';
import { startWindowShell } from '../../../src/host/windowShell.ts';
import {
  chooseImmersiveHostFullscreen,
  immersiveHostFullscreenAtom,
} from '../../../src/immersive/page/immersivePrefs.ts';
import { controlsVisibleAtom, IDLE_HIDE_MS } from '../../../src/immersive/page/immersiveShell.ts';
import { startCommandRegistry } from '../../../src/nav/commandRegistry.ts';
import { historyAtom, startNavHistory } from '../../../src/nav/navHistory.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const flush = async () => {
  for (let n = 0; n < 6; n += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};
const VIEW = { spectrum: null, terrain: null, stereo: null };
afterEach(() => vi.useRealTimers());

function setup() {
  const host = installFakeHost();
  let fullscreen = false;
  host.answer('window.isFullscreen', () => ({
    success: true,
    fullscreen,
    isFullscreen: fullscreen,
    windowId: 'main',
  }));
  host.answer('window.enterFullscreen', () => {
    fullscreen = true;
    return { success: true, isFullscreen: true };
  });
  host.answer('window.exitFullscreen', () => {
    fullscreen = false;
    return { success: true, isFullscreen: false };
  });
  const store = createStore();
  let focused = true;
  const document = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => focused });
  const window = new EventTarget();
  const activity = startWindowActivity(
    store,
    { refreshState: async () => {} },
    { document, window },
  );
  const history = startNavHistory(store);
  const commands = startCommandRegistry(null);
  const playback = {
    playOrPause: vi.fn(async () => {}),
    seek: vi.fn(async () => {}),
    stepVolume: vi.fn(async () => {}),
  };
  const integration = startImmersiveIntegration(store, { history, commands, playback }, host.fb);
  const entry = () => store.get(historyAtom).entry;
  const open = () => {
    history.navigate({ id: 'nowPlaying' });
    const shell = integration.enter(entry())?.shell;
    if (!shell) throw new Error('会话未启动');
    return shell;
  };
  const emitFullscreen = (value: boolean) => {
    fullscreen = value;
    host.emit('window:stateChanged', {
      windowId: 'main',
      isMaximized: false,
      maximized: false,
      isMinimized: false,
      minimized: false,
      isActive: true,
      active: true,
      isFullscreen: value,
      fullscreen: value,
    });
  };
  onTestFinished(() => {
    integration.dispose();
    activity.dispose();
    commands.dispose();
  });
  return {
    host,
    store,
    history,
    commands,
    integration,
    entry,
    open,
    emitFullscreen,
    mini(active: boolean, failure: 'restore' | null = null) {
      store.set(miniWindowAtom, { ...store.get(miniWindowAtom), active, failure });
    },
    visible(visible: boolean) {
      document.hidden = !visible;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    focus(value: boolean) {
      focused = value;
      window.dispatchEvent(new Event(value ? 'focus' : 'blur'));
    },
  };
}

describe('沉浸会话装配', () => {
  it('导航本身不启动会话，页面就绪后同一记录只建一份壳', async () => {
    const x = setup();
    x.history.navigate({ id: 'nowPlaying' });
    await flush();
    expect(x.host.listenerCount('window:stateChanged')).toBe(0);
    expect(x.commands.list()).toEqual([]);
    const shell = x.integration.enter(x.entry());
    expect(shell?.shell.current()).toBe(true);
    expect(x.integration.enter(x.entry())).toBe(shell);
    expect(x.host.listenerCount('window:stateChanged')).toBe(1);
    expect(x.commands.list()).toHaveLength(8);
  });

  it('离开后拒绝旧页面的迟到启动，应用释放后也不能重启', () => {
    const x = setup();
    x.history.navigate({ id: 'nowPlaying' });
    const old = x.entry();
    x.history.back();
    expect(x.integration.enter(old)).toBeNull();
    expect(x.integration.enter(x.entry())).toBeNull();
    expect(x.host.listenerCount('window:stateChanged')).toBe(0);
    x.history.forward();
    x.integration.dispose();
    expect(x.integration.enter(old)).toBeNull();
  });

  it('迷你切换保留全屏记账，恢复失败仍留在当前记录，恢复不重复进入全屏', async () => {
    const x = setup();
    const shell = x.open();
    await flush();
    await shell.toggleFullscreen();
    const own = x.entry();
    for (let n = 0; n < 3; n += 1) {
      x.mini(true);
      x.emitFullscreen(false);
      expect(x.entry()).toBe(own);
      expect(shell.current()).toBe(true);
      expect(x.commands.list()).toEqual([]);
      x.mini(true, 'restore');
      x.emitFullscreen(false);
      expect(x.entry()).toBe(own);
      x.emitFullscreen(true);
      x.mini(false);
      expect(x.integration.enter(own)?.shell).toBe(shell);
      expect(x.commands.list()).toHaveLength(8);
    }
    expect(x.host.callsTo('window.enterFullscreen')).toHaveLength(1);
    expect(x.host.callsTo('window.exitFullscreen')).toEqual([]);
    shell.leave();
    await flush();
    expect(x.store.get(historyAtom).place.id).toBe('albums');
    expect(x.host.callsTo('window.exitFullscreen')).toHaveLength(1);
    expect(x.commands.list()).toEqual([]);
  });

  it('隐藏同步清理命令与控件计时，恢复继续同一会话；仅失焦不销毁', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const x = setup();
    const shell = x.open();
    await flush();
    await shell.toggleFullscreen();
    const own = x.entry();
    x.focus(false);
    expect(x.commands.list()).toHaveLength(8);
    x.visible(false);
    expect(x.commands.list()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(shell.current()).toBe(true);
    expect(x.entry()).toBe(own);
    vi.advanceTimersByTime(IDLE_HIDE_MS * 2);
    expect(x.store.get(controlsVisibleAtom)).toBe(true);
    x.visible(true);
    expect(x.integration.enter(own)?.shell).toBe(shell);
    expect(x.commands.list()).toHaveLength(8);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(x.store.get(controlsVisibleAtom)).toBe(false);
    expect(x.host.callsTo('window.enterFullscreen')).toHaveLength(1);
    expect(x.host.callsTo('window.exitFullscreen')).toEqual([]);
  });

  it('返回曾用过的记录时创建新会话，旧壳与旧清理不影响它', async () => {
    const x = setup();
    const first = x.open();
    const own = x.entry();
    x.history.back();
    expect(first.current()).toBe(false);
    expect(x.host.listenerCount('window:stateChanged')).toBe(0);
    x.history.forward();
    expect(x.entry()).toBe(own);
    const second = x.integration.enter(own)?.shell;
    expect(second).not.toBe(first);
    first.dispose();
    expect(second?.current()).toBe(true);
    expect(x.host.listenerCount('window:stateChanged')).toBe(1);
    await flush();
  });

  it('先初始化设置并修改，再进沉浸或重新进入，都不覆盖尚未存下的选择', async () => {
    const x = setup();
    initializeImmersivePrefs(x.store);
    chooseImmersiveHostFullscreen(x.store, true, null);
    expect(x.host.calls).toEqual([]);
    x.open();
    await flush();
    expect(x.store.get(immersiveHostFullscreenAtom)).toBe(true);
    expect(x.host.callsTo('window.enterFullscreen')).toHaveLength(1);
    x.history.back();
    await flush();
    x.open();
    await flush();
    expect(x.store.get(immersiveHostFullscreenAtom)).toBe(true);
    expect(x.host.callsTo('window.enterFullscreen')).toHaveLength(2);
  });

  it('应用释放同步结束会话且幂等，后续可见性和历史变化不再登记命令', async () => {
    const x = setup();
    const shell = x.open();
    await flush();
    await shell.toggleFullscreen();
    x.integration.dispose();
    expect(x.store.get(x.integration.visible)).toBe(false);
    x.integration.dispose();
    expect(shell.current()).toBe(false);
    expect(x.host.listenerCount('window:stateChanged')).toBe(0);
    x.mini(true);
    x.mini(false);
    x.visible(false);
    x.visible(true);
    x.history.back();
    expect(x.commands.list()).toEqual([]);
    await flush();
    expect(x.host.callsTo('window.exitFullscreen')).toHaveLength(1);
  });

  it('同一记录的取数只创建一次，隐藏、最小化、迷你同步休眠，失焦不停止', async () => {
    const x = setup();
    x.open();
    const states: boolean[] = [];
    const dispose = vi.fn();
    const start = vi.fn((active: Atom<boolean>) => {
      states.push(x.store.get(active));
      const off = x.store.sub(active, () => states.push(x.store.get(active)));
      return {
        view: VIEW,
        dispose: () => {
          off();
          dispose();
        },
      };
    });
    const entry = x.entry();
    const session = x.integration.enter(entry, start);
    expect(session?.resources?.view).toBe(VIEW);
    x.focus(false);
    expect(states).toEqual([true]);
    x.visible(false);
    expect(states).toEqual([true, false]);
    x.visible(true);
    const snapshot = await x.host.fb.ui.getState();
    if (snapshot.success === false) throw new Error('缺少窗口快照');
    let minimized = true;
    x.host.answer('window.getState', () => ({ ...snapshot, minimized, isMinimized: minimized }));
    const shell = startWindowShell(x.store, x.host.fb);
    onTestFinished(() => shell.dispose());
    await shell.ready;
    expect(states.at(-1)).toBe(false);
    minimized = false;
    await shell.refreshState();
    for (let n = 0; n < 20; n += 1) {
      x.mini(true);
      expect(states.at(-1)).toBe(false);
      x.mini(false);
      x.integration.enter(entry, start);
      expect(states.at(-1)).toBe(true);
    }
    expect(start).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    x.history.back();
    expect(session && x.store.get(session.active)).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    x.integration.enter(entry, start);
    expect(start).toHaveBeenCalledTimes(1);
    x.integration.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('隐藏时页面就绪，音频工厂初读即为休眠，应用释放仍清理', () => {
    const x = setup();
    x.visible(false);
    x.history.navigate({ id: 'nowPlaying' });
    const dispose = vi.fn();
    const start = vi.fn((active: Atom<boolean>) => {
      expect(x.store.get(active)).toBe(false);
      return { dispose, view: VIEW };
    });
    x.integration.enter(x.entry(), start);
    x.integration.dispose();
    expect(start).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('音频清理失败也结束全屏壳，后续释放不重复清理', () => {
    const x = setup();
    const shell = x.open();
    const dispose = vi.fn(() => {
      throw new Error('audio cleanup failed');
    });
    x.integration.enter(x.entry(), () => ({ dispose, view: VIEW }));
    expect(() => x.integration.dispose()).toThrow('audio cleanup failed');
    expect(shell.current()).toBe(false);
    expect(x.host.listenerCount('window:stateChanged')).toBe(0);
    x.integration.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
