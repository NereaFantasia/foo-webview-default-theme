import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { miniWindowAtom, startMiniWindow } from '../../../src/host/miniWindow.ts';
import {
  MINI_POSITION_STORAGE_KEY,
  readMiniPosition,
  type Edges,
  type ScreenView,
} from '../../../src/host/miniPlacement.ts';
import {
  MINI_WINDOW_STORAGE_KEY,
  readMiniWindowSnapshot,
  type MiniWindowStorage,
} from '../../../src/host/miniWindowSnapshot.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

function memory(seed = '') {
  const values = new Map<string, string>();
  if (seed) values.set(MINI_WINDOW_STORAGE_KEY, seed);
  let saved = true;
  const storage: MiniWindowStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next);
    },
    settled: async () => {},
    saveState: () =>
      saved ? { status: 'saved', generation: 1 } : { status: 'failed', reason: 'write-failed' },
  };
  return {
    storage,
    fail: () => {
      saved = false;
    },
    raw: () => values.get(MINI_WINDOW_STORAGE_KEY) ?? null,
  };
}

function setup(
  options: {
    maximized?: boolean;
    fullscreen?: boolean;
    ratio?: number;
    seed?: string;
    normal?: { x: number; y: number; width: number; height: number };
    /** 工作区，物理像素；给了才报窗口位置，否则窗口只改尺寸。 */
    work?: Edges;
  } = {},
) {
  const host = installFakeHost();
  const prefs = memory(options.seed);
  const normal = options.normal ?? { x: -1100, y: 90, width: 1100, height: 760 };
  let bounds = { ...normal };
  let maximized = options.maximized ?? false;
  let fullscreen = options.fullscreen ?? false;
  let pinned = false;
  let resizable = true;
  let min = { width: 800, height: 500 };
  let max = { width: 1800, height: 1200 };
  host.answer('window.getMode', {
    success: true,
    mode: 'standalone',
    panelMode: false,
    windowId: 'main',
  });
  host.answer('window.getBounds', () => ({ success: true, ...bounds }));
  host.answer('window.getState', () => ({
    success: true,
    ...bounds,
    maximized,
    fullscreen,
    alwaysOnTop: pinned,
    minimized: false,
    focused: true,
    isMaximized: maximized,
    isFullscreen: fullscreen,
    isAlwaysOnTop: pinned,
    isMinimized: false,
    isFocused: true,
  }));
  host.answer('window.getMinSize', () => ({ success: true, ...min, windowId: 'main' }));
  host.answer('window.getMaxSize', () => ({ success: true, ...max, windowId: 'main' }));
  host.answer('window.isResizable', () => ({ success: true, resizable, windowId: 'main' }));
  host.answer('window.setMinSize', (p) => {
    min = { width: Number(p['width']), height: Number(p['height']) };
    return { success: true, ...min, windowId: 'main' };
  });
  host.answer('window.setMaxSize', (p) => {
    max = { width: Number(p['width']), height: Number(p['height']) };
    return { success: true, ...max, windowId: 'main' };
  });
  host.answer('window.setBounds', (p) => {
    bounds = {
      x: Number(p['x'] ?? bounds.x),
      y: Number(p['y'] ?? bounds.y),
      width: Number(p['width'] ?? bounds.width),
      height: Number(p['height'] ?? bounds.height),
    };
    return { success: true };
  });
  host.answer('window.restore', () => {
    maximized = false;
    return { success: true };
  });
  host.answer('window.maximize', () => {
    maximized = true;
    return { success: true };
  });
  host.answer('window.setFullscreen', (p) => {
    fullscreen = p['enabled'] === true;
    return { success: true, fullscreen, windowId: 'main' };
  });
  host.answer('window.setAlwaysOnTop', (p) => {
    pinned = p['enabled'] === true;
    return { success: true };
  });
  host.answer('window.startDrag', { success: true });
  host.answer('window.center', { success: true });
  host.answer('window.setResizable', (p) => {
    resizable = p['resizable'] === true;
    return { success: true, resizable, windowId: 'main' };
  });
  const store = createStore();
  const shell = { setTitlebarHeight: vi.fn(), setMaximizeButtonRegion: vi.fn() };
  const ratio = options.ratio ?? 1;
  const work = options.work;
  const css = (edges: Edges): Edges => ({
    left: edges.left / ratio,
    top: edges.top / ratio,
    right: edges.right / ratio,
    bottom: edges.bottom / ratio,
  });
  const screen = (): ScreenView | null =>
    work
      ? {
          window: css({
            left: bounds.x,
            top: bounds.y,
            right: bounds.x + bounds.width,
            bottom: bounds.y + bounds.height,
          }),
          work: css(work),
        }
      : null;
  const mini = startMiniWindow(store, prefs.storage, shell, host.fb, {
    pixelRatio: () => ratio,
    screen,
    settleMove: async () => {},
  });
  onTestFinished(() => mini.dispose());
  return {
    host,
    prefs,
    mini,
    shell,
    store,
    normal,
    state: () => store.get(miniWindowAtom),
    native: () => ({ bounds, min, max, resizable, maximized, fullscreen, pinned }),
    moveTo: (x: number, y: number) => {
      bounds = { ...bounds, x, y };
    },
  };
}

describe('主窗口迷你模式', () => {
  it('缩小前保存普通窗口，返回时恢复边界、限制与置顶，不创建其他窗口', async () => {
    const x = setup();
    await x.mini.ready;
    await x.mini.enter();
    expect(x.state()).toMatchObject({ active: true, busy: false, failure: null });
    expect(x.native().bounds).toEqual({ ...x.normal, width: 333, height: 133 });
    expect(readMiniWindowSnapshot(x.prefs.storage)?.bounds).toEqual(x.normal);
    expect(x.native().resizable).toBe(false);
    expect(x.shell.setMaximizeButtonRegion).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    await x.mini.togglePin();
    expect(x.native().pinned).toBe(true);
    await x.mini.leave();
    expect(x.state()).toMatchObject({ active: false, busy: false, failure: null });
    expect(x.native()).toEqual({
      bounds: x.normal,
      min: { width: 800, height: 500 },
      max: { width: 1800, height: 1200 },
      resizable: true,
      maximized: false,
      fullscreen: false,
      pinned: false,
    });
    expect(readMiniWindowSnapshot(x.prefs.storage)).toBeNull();
    expect(x.host.callsTo('window.createPopup')).toEqual([]);
  });

  it('尺寸乘界面缩放与设备像素比；紧凑态菜单临时增高，封面态菜单不改尺寸', async () => {
    const x = setup({ ratio: 1.5 });
    await x.mini.ready;
    await x.mini.enter();
    expect(x.native().bounds).toMatchObject({ width: 499, height: 200 });
    await x.mini.setMenu(true);
    expect(x.native().bounds.height).toBe(383);
    await x.mini.setMenu(false);
    expect(x.native().bounds.height).toBe(200);
    await x.mini.setForm('cover');
    expect(x.native().bounds).toMatchObject({ width: 420, height: 599 });
    await x.mini.setMenu(true);
    expect(x.native().bounds.height).toBe(599);
    await x.mini.setMenu(false);
    expect(x.state()).toMatchObject({ form: 'cover', menu: false });
    expect(x.native().bounds.height).toBe(599);
  });

  it('只在迷你模式里经宿主拖动窗口', async () => {
    const x = setup();
    await x.mini.ready;
    x.mini.drag();
    expect(x.host.callsTo('window.startDrag')).toHaveLength(0);
    await x.mini.enter();
    x.mini.drag();
    await vi.waitFor(() => expect(x.host.callsTo('window.startDrag')).toHaveLength(1));
  });

  it('最大化与全屏进入，返回时恢复原窗口模式', async () => {
    const x = setup({ maximized: true, fullscreen: true });
    await x.mini.ready;
    await x.mini.enter();
    expect(x.native()).toMatchObject({ maximized: false, fullscreen: false });
    await x.mini.leave();
    expect(x.native()).toMatchObject({ maximized: true, fullscreen: true, bounds: x.normal });
  });

  it('恢复记录未能落盘时不改变宿主窗口', async () => {
    const x = setup();
    await x.mini.ready;
    x.prefs.fail();
    await x.mini.enter();
    expect(x.state()).toMatchObject({ active: false, busy: false, failure: 'save' });
    expect(x.native().bounds).toEqual(x.normal);
    expect(x.host.callsTo('window.setBounds')).toEqual([]);
  });

  it('进入时宿主拒绝缩放，回退完整窗口并保留错误', async () => {
    const x = setup();
    await x.mini.ready;
    const original = x.host.answer;
    let first = true;
    original.call(x.host, 'window.setBounds', () => {
      if (first) {
        first = false;
        return hostFailure('OPERATION_FAILED');
      }
      return { success: true };
    });
    await x.mini.enter();
    expect(x.state()).toMatchObject({ active: false, busy: false, failure: 'enter' });
    expect(x.native()).toMatchObject({ resizable: true, min: { width: 800, height: 500 } });
  });

  it('返回失败时保留恢复记录，下一次返回可以继续恢复', async () => {
    const x = setup();
    await x.mini.ready;
    await x.mini.enter();
    x.host.answer('window.restore', hostFailure('OPERATION_FAILED'));
    await x.mini.leave();
    expect(x.state()).toMatchObject({ active: true, busy: false, failure: 'restore' });
    expect(readMiniWindowSnapshot(x.prefs.storage)).not.toBeNull();
    x.host.answer('window.restore', { success: true });
    await x.mini.leave();
    expect(x.state().active).toBe(false);
    expect(x.native().bounds).toEqual(x.normal);
  });

  it('页面重新启动时先恢复记录中的完整窗口', async () => {
    const x = setup({
      seed: JSON.stringify({
        bounds: { x: 35, y: 45, width: 1000, height: 720 },
        min: { width: 700, height: 400 },
        max: { width: 0, height: 0 },
        pinned: true,
        maximized: false,
        fullscreen: false,
        resizable: true,
      }),
    });
    expect(x.state()).toMatchObject({ active: true, busy: true });
    await x.mini.ready;
    expect(x.state()).toMatchObject({ active: false, failure: null });
    expect(x.native()).toMatchObject({
      bounds: { x: 35, y: 45, width: 1000, height: 720 },
      pinned: true,
    });
  });

  it('连续点击不会交错修改窗口，释放后不继续下发步骤', async () => {
    const x = setup();
    await x.mini.ready;
    const held = x.host.hold('window.getBounds');
    const entering = x.mini.enter();
    await vi.waitFor(() => expect(held.pending.length).toBe(1));
    await x.mini.enter();
    await x.mini.setForm('cover');
    expect(x.host.callsTo('window.getMode')).toHaveLength(1);
    x.mini.dispose();
    held.respond(0, { success: true, ...x.normal });
    await entering;
    expect(x.host.callsTo('window.setBounds')).toEqual([]);
  });

  it('靠下靠右时贴着右下角伸缩：展开往上、往左长，收起回到原处', async () => {
    const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
    const x = setup({ work, normal: { x: 900, y: 300, width: 1000, height: 700 } });
    await x.mini.ready;
    await x.mini.enter();
    expect(x.native().bounds).toEqual({ x: 1567, y: 867, width: 333, height: 133 });
    await x.mini.setMenu(true);
    expect(x.native().bounds).toEqual({ x: 1567, y: 744, width: 333, height: 256 });
    await x.mini.setMenu(false);
    await x.mini.setForm('cover');
    expect(x.native().bounds).toEqual({ x: 1620, y: 601, width: 280, height: 399 });
    await x.mini.setForm('compact');
    expect(x.native().bounds).toEqual({ x: 1567, y: 867, width: 333, height: 133 });
  });

  it('靠上靠左时贴着左上角伸缩，展开往下长', async () => {
    const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
    const x = setup({ work, normal: { x: 0, y: 0, width: 1200, height: 800 } });
    await x.mini.ready;
    await x.mini.enter();
    expect(x.native().bounds).toEqual({ x: 0, y: 0, width: 333, height: 133 });
    await x.mini.setMenu(true);
    expect(x.native().bounds).toEqual({ x: 0, y: 0, width: 333, height: 256 });
  });

  it('离开与拖完时记下贴着的那一角，下次进入按那一角放回', async () => {
    const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
    const x = setup({ work, normal: { x: 100, y: 100, width: 1000, height: 700 } });
    await x.mini.ready;
    await x.mini.enter();
    x.moveTo(1560, 880);
    x.mini.drag();
    await vi.waitFor(() =>
      expect(readMiniPosition(x.prefs.storage)).toEqual({
        corner: { vertical: 'bottom', horizontal: 'right' },
        x: 1893,
        y: 1013,
      }),
    );
    await x.mini.setForm('cover');
    await x.mini.leave();
    expect(readMiniPosition(x.prefs.storage)).toEqual({
      corner: { vertical: 'bottom', horizontal: 'right' },
      x: 1893,
      y: 1013,
    });
    expect(x.native().bounds).toEqual({ x: 100, y: 100, width: 1000, height: 700 });
    await x.mini.enter();
    expect(x.native().bounds).toEqual({ x: 1613, y: 614, width: 280, height: 399 });
  });

  it('记住的位置已不在任何屏幕上时交给宿主居中', async () => {
    const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
    const x = setup({ work, normal: { x: 100, y: 100, width: 1000, height: 700 } });
    x.prefs.storage.setItem(
      MINI_POSITION_STORAGE_KEY,
      JSON.stringify({ corner: { vertical: 'top', horizontal: 'left' }, x: 4000, y: 200 }),
    );
    await x.mini.ready;
    await x.mini.enter();
    expect(x.native().bounds).toMatchObject({ x: 4000, y: 200 });
    expect(x.host.callsTo('window.center')).toHaveLength(1);
  });

  it('记住的位置越出工作区一部分时推回来', async () => {
    const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
    const x = setup({ work, normal: { x: 100, y: 100, width: 1000, height: 700 } });
    x.prefs.storage.setItem(
      MINI_POSITION_STORAGE_KEY,
      JSON.stringify({ corner: { vertical: 'bottom', horizontal: 'right' }, x: 2000, y: 1100 }),
    );
    await x.mini.ready;
    await x.mini.enter();
    expect(x.native().bounds).toEqual({ x: 1587, y: 907, width: 333, height: 133 });
    expect(x.host.callsTo('window.center')).toEqual([]);
  });

  it('面板模式不发窗口修改命令', async () => {
    const x = setup();
    await x.mini.ready;
    x.host.answer('window.getMode', {
      success: true,
      mode: 'dui',
      panelMode: true,
      windowId: 'panel',
    });
    await x.mini.enter();
    expect(x.state()).toMatchObject({ active: false, failure: 'enter' });
    expect(x.host.callsTo('window.setBounds')).toEqual([]);
  });
});

describe('窗口恢复记录', () => {
  it.each(['bad json', 'null', '{"bounds":{"width":-1}}', '{"bounds":{"width":"420"}}'])(
    '拒绝无效记录 %s',
    (raw) => {
      expect(readMiniWindowSnapshot(memory(raw).storage)).toBeNull();
    },
  );
  it('使用独立偏好键，不覆盖宿主或完整界面的现有存档', () => {
    expect(MINI_WINDOW_STORAGE_KEY).toBe('default-theme.mini-window.v1');
  });
});

describe('迷你窗口位置记录', () => {
  it.each([
    'bad json',
    '{"x":1,"y":2}',
    '{"corner":{"vertical":"middle","horizontal":"left"},"x":1,"y":2}',
    '{"corner":{"vertical":"top","horizontal":"left"},"x":"1","y":2}',
  ])('拒绝无效记录 %s', (raw) => {
    expect(readMiniPosition({ getItem: () => raw })).toBeNull();
  });
  it('使用独立偏好键', () => {
    expect(MINI_POSITION_STORAGE_KEY).toBe('default-theme.mini-position.v1');
  });
});
