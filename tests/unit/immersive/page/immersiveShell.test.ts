import type { WindowStateChangedPayload } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  controlsVisibleAtom,
  hostFullscreenAtom,
  IDLE_HIDE_MS,
  startImmersiveShell,
  type ImmersiveShell,
} from '../../../../src/immersive/page/immersiveShell.ts';
import { historyAtom, startNavHistory } from '../../../../src/nav/navHistory.ts';
import { START_PLACE, type Place } from '../../../../src/nav/places.ts';
import type { Store } from '../../../../src/kit/store.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

/**
 * 正在播放全屏页的壳：静止计时、全屏记账与离开。宿主是接在真实 SDK 上的替身，全屏三条命令按
 * 替身里记着的全屏态作答，`stateChanged` 由用例推，不改替身的全屏态；历史是真的，页面在「专辑 → 正在播放」
 * 这条路上。
 */
const NOW_PLAYING: Place = { id: 'nowPlaying' };

function stateOf(fullscreen: boolean): WindowStateChangedPayload {
  return {
    windowId: 'main',
    isMaximized: false,
    isMinimized: false,
    maximized: false,
    minimized: false,
    isActive: true,
    active: true,
    isFullscreen: fullscreen,
    fullscreen,
  };
}

interface HostSetup {
  available?: boolean;
  /** 进视图前宿主已经全屏。 */
  fullscreenAtStart?: boolean;
  /** `isFullscreen` 答失败：面板模式、这扇窗不支持全屏。 */
  unsupported?: boolean;
  /** `enterFullscreen` 应答成功却没进全屏。 */
  enterNoop?: boolean;
  /** `enterFullscreen` 答失败信封。 */
  enterRefused?: boolean;
  /** 不给 `enterFullscreen` 配应答：调用 reject，服务收成 null。 */
  enterThrows?: boolean;
}

function fakeHost(setup: HostSetup = {}) {
  const host = installFakeHost({ available: setup.available ?? true });
  let fullscreen = setup.fullscreenAtStart ?? false;
  host.answer('window.isFullscreen', () =>
    setup.unsupported
      ? hostFailure('NOT_SUPPORTED', 'panel mode')
      : { success: true, fullscreen, isFullscreen: fullscreen, windowId: 'main' },
  );
  // 与宿主一样：已经全屏时再进、不在全屏时退，都答 OPERATION_FAILED。
  if (!setup.enterThrows) {
    host.answer('window.enterFullscreen', () => {
      if (setup.enterRefused) return hostFailure('OPERATION_FAILED', 'refused');
      if (fullscreen) return hostFailure('OPERATION_FAILED', 'Window is already fullscreen');
      if (!setup.enterNoop) fullscreen = true;
      return { success: true, isFullscreen: fullscreen };
    });
  }
  host.answer('window.exitFullscreen', () => {
    if (!fullscreen) return hostFailure('OPERATION_FAILED', 'Window is not fullscreen');
    fullscreen = false;
    return { success: true, isFullscreen: false };
  });
  const calls = () =>
    host.calls
      .map((call) => call.method)
      .filter(
        (method) => method === 'window.enterFullscreen' || method === 'window.exitFullscreen',
      );
  return { host, calls };
}

/** 让排着的微任务与 setImmediate 回调跑完几轮；只假 setTimeout 时不会卡住。 */
async function flush(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function mount(host: UnitHost, options: { fullscreen?: boolean } = {}) {
  const store = createStore();
  const history = startNavHistory(store);
  history.navigate(NOW_PLAYING);
  const shell = startImmersiveShell(store, {
    history,
    host: host.fb,
    fullscreenOnEnter: () => options.fullscreen ?? false,
  });
  await flush();
  return { store, history, shell, place: () => store.get(historyAtom).place.id };
}

const fullscreenOf = (store: Store) => store.get(hostFullscreenAtom);
const visible = (store: Store) => store.get(controlsVisibleAtom);

afterEach(() => {
  vi.useRealTimers();
});

describe('静止计时', () => {
  test('静止 3 s 藏控件层；touch() 立刻回来并重新计时', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { store, shell } = await mount(fakeHost().host);
    expect(visible(store)).toBe(true);
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    expect(visible(store)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible(store)).toBe(false);

    shell.touch();
    expect(visible(store)).toBe(true);
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    shell.touch();
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    expect(visible(store)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible(store)).toBe(false);
  });

  test('无宿主（浏览器里跑开发服务器）：不发全屏命令、不订阅事件，静止计时与离开照常', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, calls } = fakeHost({ available: false });
    const { store, shell, place } = await mount(host, { fullscreen: true });
    expect(calls()).toStrictEqual([]);
    expect(host.listenerCount('window:stateChanged')).toBe(0);
    expect(fullscreenOf(store)).toBeNull();
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(visible(store)).toBe(false);
    shell.leave();
    expect(place()).toBe(START_PLACE.id);
    expect(calls()).toStrictEqual([]);
  });
});

describe('进入与离开', () => {
  test('进入时不全屏（缺省）：不发命令，照样订 stateChanged 跟着宿主；宿主进出全屏不连带离开', async () => {
    const { host, calls } = fakeHost();
    const { store, shell, place } = await mount(host);
    expect(calls()).toStrictEqual([]);
    expect(host.listenerCount('window:stateChanged')).toBe(1);
    expect(fullscreenOf(store)).toBe(false);
    host.emit('window:stateChanged', stateOf(true));
    expect(fullscreenOf(store)).toBe(true);
    host.emit('window:stateChanged', stateOf(false));
    expect(place()).toBe('nowPlaying');
    shell.leave();
    expect(place()).toBe('albums');
    expect(calls()).toStrictEqual([]);
  });

  test('进入时全屏：发一次 enterFullscreen；Esc 离开时先退全屏再后退，一次两样都退', async () => {
    const { host, calls } = fakeHost();
    const { store, shell, place } = await mount(host, { fullscreen: true });
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
    expect(fullscreenOf(store)).toBe(true);
    shell.leave();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
    expect(place()).toBe('albums');
    shell.leave();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
  });

  test('后退退不回去（前面的记录都被上限挤掉了）：去起始地点', async () => {
    const { host } = fakeHost();
    const store = createStore();
    const history = { back: vi.fn(() => false), navigate: vi.fn() };
    const shell = startImmersiveShell(store, {
      history,
      host: host.fb,
      fullscreenOnEnter: () => false,
    });
    await flush();
    shell.leave();
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(history.navigate.mock.calls).toStrictEqual([[START_PLACE]]);
  });

  test('宿主拒绝、没真进或调用失败：照常留在视图里，离开不发 exitFullscreen', async () => {
    for (const setup of [{ enterRefused: true }, { enterNoop: true }, { enterThrows: true }]) {
      const { host, calls } = fakeHost(setup);
      const { shell, place } = await mount(host, { fullscreen: true });
      expect(place()).toBe('nowPlaying');
      shell.leave();
      await flush();
      expect(calls(), JSON.stringify(setup)).toStrictEqual(['window.enterFullscreen']);
      expect(place()).toBe('albums');
    }
  });

  test('没真进全屏时，stateChanged 报假不算宿主侧退出', async () => {
    const { host, calls } = fakeHost({ enterNoop: true });
    const { shell, place } = await mount(host, { fullscreen: true });
    host.emit('window:stateChanged', stateOf(false));
    expect(place()).toBe('nowPlaying');
    shell.dispose();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
  });

  test('宿主自己退了视图让它进的全屏：跟着后退，不再发 exitFullscreen，事件摘掉', async () => {
    const { host, calls } = fakeHost();
    const { place } = await mount(host, { fullscreen: true });
    host.emit('window:stateChanged', stateOf(true));
    expect(place()).toBe('nowPlaying');
    host.emit('window:stateChanged', stateOf(false));
    await flush();
    expect(place()).toBe('albums');
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
    expect(host.listenerCount('window:stateChanged')).toBe(0);
  });

  test('别的跳转离开这一页（Alt+← 等）：视图让宿主进的全屏一并退掉，之后的宿主事件不再触发后退', async () => {
    const { host, calls } = fakeHost();
    const { store, history, place } = await mount(host, { fullscreen: true });
    history.navigate({ id: 'settings' });
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
    host.emit('window:stateChanged', stateOf(false));
    expect(place()).toBe('settings');
    expect(host.listenerCount('window:stateChanged')).toBe(0);
    const before = store.get(hostFullscreenAtom);
    host.emit('window:stateChanged', stateOf(true));
    expect(store.get(hostFullscreenAtom)).toBe(before);
  });

  test('dispose：计时与监听全清，视图让宿主进的全屏退掉；之后 touch 与计时都不再写状态', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { host, calls } = fakeHost();
    const { store, shell } = await mount(host, { fullscreen: true });
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    shell.dispose();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
    expect(host.listenerCount('window:stateChanged')).toBe(0);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(visible(store)).toBe(true);
    shell.touch();
    shell.leave();
    await shell.toggleFullscreen();
    expect(shell.current()).toBe(false);
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
  });

  test('等进全屏的应答期间已经离开：宿主真进了就补一次 exitFullscreen，没进就不补', async () => {
    const entered = fakeHost();
    const held = entered.host.hold('window.enterFullscreen');
    const first = await mount(entered.host, { fullscreen: true });
    first.shell.dispose();
    expect(entered.calls()).toStrictEqual(['window.enterFullscreen']);
    held.release();
    await flush();
    expect(entered.calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);

    const refused = fakeHost({ enterRefused: true });
    const heldRefusal = refused.host.hold('window.enterFullscreen');
    const second = await mount(refused.host, { fullscreen: true });
    second.shell.dispose();
    heldRefusal.release();
    await flush();
    expect(refused.calls()).toStrictEqual(['window.enterFullscreen']);
  });
});

describe('同一页先后两个壳', () => {
  function sameEntry(host: UnitHost, fullscreen: boolean) {
    const store = createStore();
    const history = startNavHistory(store);
    history.navigate(NOW_PLAYING);
    const start = () =>
      startImmersiveShell(store, { history, host: host.fb, fullscreenOnEnter: () => fullscreen });
    return { store, start, place: () => store.get(historyAtom).place.id };
  }

  test('挂上、立即卸下、再挂上（React 严格模式）：只有后一个壳发进入全屏，没有退出，视图留着', async () => {
    const { host, calls } = fakeHost();
    const { store, start, place } = sameEntry(host, true);
    start().dispose();
    const shell = start();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
    expect(fullscreenOf(store)).toBe(true);
    expect(place()).toBe('nowPlaying');
    shell.leave();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
  });

  test('旧壳的全屏键应答晚于它离开、新壳已起来：记账交给新壳，不补退出；新壳离开时再退', async () => {
    const { host, calls } = fakeHost();
    const { store, start, place } = sameEntry(host, false);
    const first = start();
    await flush();
    const held = host.hold('window.enterFullscreen');
    const pending = first.toggleFullscreen();
    first.dispose();
    const second = start();
    await flush();
    held.release();
    await pending;
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
    expect(fullscreenOf(store)).toBe(true);
    expect(place()).toBe('nowPlaying');
    second.leave();
    await flush();
    expect(calls()).toStrictEqual(['window.enterFullscreen', 'window.exitFullscreen']);
  });
});

describe('宿主事件与初读', () => {
  test('别的窗口的 stateChanged 不算：弹出窗口退全屏不连带离开，也不改这一页的全屏态', async () => {
    const { host, calls } = fakeHost();
    const { store, place } = await mount(host, { fullscreen: true });
    host.emit('window:stateChanged', { ...stateOf(false), windowId: 'popup-1' });
    expect(place()).toBe('nowPlaying');
    expect(fullscreenOf(store)).toBe(true);
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
  });

  test('本窗口的 id 按 getCurrentWindowId 认：取回之后只跟这个 id 的事件', async () => {
    const { host } = fakeHost();
    host.answer('window.getCurrentWindowId', { success: true, windowId: 'popup-1' });
    const { store } = await mount(host);
    host.emit('window:stateChanged', stateOf(true));
    expect(fullscreenOf(store)).toBe(false);
    host.emit('window:stateChanged', { ...stateOf(true), windowId: 'popup-1' });
    expect(fullscreenOf(store)).toBe(true);
  });

  test('isFullscreen 的初读晚于 stateChanged 到达：丢掉旧的初读，以事件为准', async () => {
    const { host } = fakeHost();
    const held = host.hold('window.isFullscreen');
    const { store } = await mount(host);
    host.emit('window:stateChanged', stateOf(true));
    held.respond(0, { success: true, fullscreen: false, isFullscreen: false, windowId: 'main' });
    await flush();
    expect(fullscreenOf(store)).toBe(true);
  });
});

describe('全屏键', () => {
  async function toggle(shell: ImmersiveShell) {
    await shell.toggleFullscreen();
    await flush();
  }

  test('窗口态下按一次进全屏、离开时还原；再按一次退全屏，随后的 stateChanged 不连带离开', async () => {
    const { host, calls } = fakeHost();
    const { store, shell, place } = await mount(host);
    await toggle(shell);
    expect(fullscreenOf(store)).toBe(true);
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
    await toggle(shell);
    host.emit('window:stateChanged', stateOf(false));
    expect(place()).toBe('nowPlaying');
    expect(fullscreenOf(store)).toBe(false);
    await toggle(shell);
    shell.leave();
    await flush();
    expect(calls()).toStrictEqual([
      'window.enterFullscreen',
      'window.exitFullscreen',
      'window.enterFullscreen',
      'window.exitFullscreen',
    ]);
    expect(place()).toBe('albums');
  });

  test('全屏键进的全屏被宿主自己退了：跟着后退，不再发 exitFullscreen', async () => {
    const { host, calls } = fakeHost();
    const { shell, place } = await mount(host);
    await toggle(shell);
    host.emit('window:stateChanged', stateOf(false));
    expect(place()).toBe('albums');
    expect(calls()).toStrictEqual(['window.enterFullscreen']);
  });

  test('进视图前宿主已经全屏：离开不动宿主窗口；按全屏键退出全屏、视图留着', async () => {
    const first = fakeHost({ fullscreenAtStart: true });
    const one = await mount(first.host);
    expect(fullscreenOf(one.store)).toBe(true);
    one.shell.leave();
    await flush();
    expect(first.calls()).toStrictEqual([]);

    const second = fakeHost({ fullscreenAtStart: true });
    const two = await mount(second.host);
    await toggle(two.shell);
    expect(two.place()).toBe('nowPlaying');
    expect(fullscreenOf(two.store)).toBe(false);
    two.shell.leave();
    await flush();
    expect(second.calls()).toStrictEqual(['window.exitFullscreen']);
  });

  test('宿主不支持全屏或不在：全屏键不出（null），按了也不发命令', async () => {
    const unsupported = fakeHost({ unsupported: true });
    const one = await mount(unsupported.host);
    expect(fullscreenOf(one.store)).toBeNull();
    await toggle(one.shell);
    expect(unsupported.calls()).toStrictEqual([]);

    const absent = fakeHost({ available: false });
    const two = await mount(absent.host);
    expect(fullscreenOf(two.store)).toBeNull();
    await toggle(two.shell);
    expect(absent.calls()).toStrictEqual([]);
  });
});
