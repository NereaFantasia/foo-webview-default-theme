import { createStore } from 'jotai/vanilla';
import { expect, it, onTestFinished, vi } from 'vitest';
import { startDesktopLyricsPopup } from '../../../../src/lyrics/desktop/desktopLyricsPopup.ts';
import {
  DESKTOP_LYRICS_VIEW_KEY,
  desktopLyricsViewJson,
  type DesktopLyricsView,
} from '../../../../src/lyrics/desktop/desktopLyricsLink.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';

const VIEW: DesktopLyricsView = {
  labels: {
    previous: '上一首',
    play: '播放',
    pause: '暂停',
    next: '下一首',
    earlier: '提前',
    later: '延后',
    align: '对齐',
    mode: '切换为单行歌词',
    lock: '锁定',
    unlock: '解锁',
    settings: '设置',
    close: '关闭',
  },
  locked: false,
  align: 'center',
  mode: 'multi',
  motionPreset: 'amll',
  multilineSize: null,
  fontSize: 34,
  sung: null,
  unsung: null,
  tint: null,
  plate: true,
  plateOpacity: 0.7,
  glow: null,
  showTranslation: true,
  showRomanization: false,
  offset: 0,
  title: '曲名',
  artist: '艺人',
  hidden: false,
};

async function setup() {
  vi.stubGlobal('devicePixelRatio', 1.25);
  vi.stubGlobal('screen', undefined);
  vi.stubGlobal('screenX', 80);
  vi.stubGlobal('screenY', 160);
  vi.stubGlobal('outerWidth', 640);
  vi.stubGlobal('outerHeight', 472);
  const host = installFakeHost();
  const store = createStore();
  let bounds = { x: 100, y: 200, width: 800, height: 590 };
  let resizable = true;
  host.answer('state.get', (params) => ({
    success: true,
    exists: true,
    value:
      params['key'] === DESKTOP_LYRICS_VIEW_KEY
        ? desktopLyricsViewJson(VIEW)
        : { id: 'none', lines: null },
  }));
  host.answer('window.getBounds', () => ({ success: true, ...bounds }));
  host.answer('window.setMinSize', { success: true, windowId: 'popup-1' });
  host.answer('window.setResizable', (params) => {
    resizable = params['resizable'] === true;
    return { success: true, windowId: 'popup-1' };
  });
  host.answer('window.setBounds', (params) => {
    bounds = {
      x: Number(params['x']),
      y: Number(params['y']),
      width: Number(params['width']),
      height: Number(params['height']),
    };
    return { success: true, windowId: 'popup-1' };
  });
  host.answer('window.setPosition', (params) => {
    bounds = { ...bounds, x: Number(params['x']), y: Number(params['y']) };
    return { success: true, windowId: 'popup-1' };
  });
  const popup = startDesktopLyricsPopup(store, host.fb, 'popup-1');
  onTestFinished(() => {
    popup.dispose();
    vi.unstubAllGlobals();
  });
  await vi.waitFor(() => expect(store.get(popup.view)).not.toBeNull());
  const setView = (patch: Partial<DesktopLyricsView>) => {
    host.emit('state:changed', {
      key: DESKTOP_LYRICS_VIEW_KEY,
      previousValue: null,
      sourceWindowId: 'main',
      value: desktopLyricsViewJson({ ...VIEW, ...patch }),
    });
    popup.setLayout(360, 164, 1088);
  };
  return { host, popup, setView, bounds: () => bounds, resizable: () => resizable };
}

it('单行固定宽高并禁用 resize，多行恢复记录的物理尺寸', async () => {
  const { setView, bounds, resizable } = await setup();
  const multilineSize = { width: 800, height: 590 };
  setView({ mode: 'single', multilineSize });
  await vi.waitFor(() => expect(bounds()).toMatchObject({ width: 1360, height: 205 }));
  expect(resizable()).toBe(false);
  setView({ mode: 'multi', multilineSize });
  await vi.waitFor(() => expect(resizable()).toBe(true));
  expect(bounds()).toMatchObject(multilineSize);
});

it('单行加宽受屏幕工作区约束，宽度变化后窗口仍在屏内', async () => {
  const { setView, bounds } = await setup();
  vi.stubGlobal('screen', { availLeft: 0, availTop: 0, availWidth: 900, availHeight: 720 });
  setView({ mode: 'single' });
  await vi.waitFor(() => expect(bounds()).toMatchObject({ width: 1065, height: 205 }));
  expect(bounds().x + bounds().width).toBeLessThanOrEqual(1125);
});

it('约束请求未返回时切模式，只执行最新尺寸且锁定保持禁用 resize', async () => {
  const { host, popup, setView, bounds, resizable } = await setup();
  const pending = host.hold('window.setMinSize');
  popup.setLayout(360, 164, 1088);
  await vi.waitFor(() => expect(pending.pending).toHaveLength(1));
  setView({ mode: 'single', locked: true });
  pending.release();
  await vi.waitFor(() => expect(bounds()).toMatchObject({ width: 1360, height: 205 }));
  expect(resizable()).toBe(false);
});

it('释放期间的旧应答不再写尺寸', async () => {
  const { host, popup, setView, bounds } = await setup();
  const pending = host.hold('window.setMinSize');
  setView({ mode: 'single' });
  await vi.waitFor(() => expect(pending.pending).toHaveLength(1));
  popup.dispose();
  pending.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(bounds()).toEqual({ x: 100, y: 200, width: 800, height: 590 });
});

it('拖动合并未完成请求，松手后采用最终屏幕位移', async () => {
  const { host, popup, bounds } = await setup();
  const pending = host.hold('window.setPosition');
  popup.beginDrag();
  popup.dragBy(10, 20);
  await vi.waitFor(() => expect(pending.pending).toHaveLength(1));
  popup.dragBy(80, 40);
  popup.endDrag();
  pending.release();
  await vi.waitFor(() => expect(bounds()).toMatchObject({ x: 200, y: 250 }));
});
