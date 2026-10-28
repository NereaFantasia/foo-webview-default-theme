import type { LyricLine } from '@applemusic-like-lyrics/core';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ConfigValue } from '../../../../src/host/configPref.ts';
import { en } from '../../../../src/i18n/en.ts';
import { createTranslate } from '../../../../src/i18n/translate.ts';
import { startDesktopLyrics } from '../../../../src/lyrics/desktop/desktopLyrics.ts';
import {
  DESKTOP_LYRICS_LINES_KEY,
  DESKTOP_LYRICS_VIEW_KEY,
  desktopLyricsMessage,
  parseDesktopLyricsLines,
  parseDesktopLyricsView,
  type DesktopLyricsCommand,
} from '../../../../src/lyrics/desktop/desktopLyricsLink.ts';
import type { LyricsState } from '../../../../src/lyrics/lyricsService.ts';
import { TRAY_IDS } from '../../../../src/playback/trayMenu.ts';
import { tealBrand } from '../../../../src/theme/brand.ts';
import { createMemoryConfigWriter } from '../../../fixtures/dataWriter.ts';
import { hostFailure } from '../../../fixtures/hostAnswers.ts';
import { installFakeHost, type UnitHost } from '../../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PREF_KEY = 'defaultTheme.desktopLyrics';

const LINES: LyricLine[] = [
  {
    words: [{ word: 'Every window', startTime: 6000, endTime: 9000 }],
    translatedLyric: '每扇窗',
    romanLyric: '',
    startTime: 6000,
    endTime: 9000,
    isBG: false,
    isDuet: false,
  },
];

function setup(config: Readonly<Record<string, ConfigValue>> = {}, existing?: UnitHost) {
  const host = existing ?? installFakeHost({ config });
  host.answerAll({
    window: {
      createPopup: { success: true, windowId: 'popup-1' },
      closePopup: { success: true },
      getAllWindows: { success: true, items: [] },
      sendMessage: { success: true },
    },
    keyboard: {
      registerHotkey: { success: true, id: 1 },
      unregisterHotkey: { success: true },
    },
  });
  const store = createStore();
  const lyricsState = atom<LyricsState>({ status: 'idle' });
  const offset = atom(0);
  const setOffset = vi.fn(async (seconds: number) => {
    store.set(offset, seconds);
    return true;
  });
  const seek = vi
    .fn<(key: string, seconds: number) => Promise<void>>()
    .mockResolvedValue(undefined);
  const service = startDesktopLyrics(
    store,
    {
      lyrics: { state: lyricsState, offset, setOffset, seek },
      track: atom({ title: 'Quiet Light', artist: 'Sample Artist' }),
      ramp: atom(tealBrand),
      shown: atom(false),
      translate: atom(() => createTranslate(en, {})),
      writer: createMemoryConfigWriter(host.fb),
      page: 'desktop-lyrics.html',
    },
    host.fb,
  );
  onTestFinished(() => service.dispose());
  const shared = async (key: string) => {
    const answer = await host.fb.sharedState.get(key);
    return answer.success ? answer.value : null;
  };
  const fromPopup = (command: DesktopLyricsCommand, source = 'popup-1') =>
    host.emit('window:message', { sourceWindowId: source, message: desktopLyricsMessage(command) });
  return { host, store, service, lyricsState, setOffset, seek, shared, fromPopup };
}

async function opened(config: Readonly<Record<string, ConfigValue>> = {}) {
  const setup_ = setup(config);
  await setup_.service.ready;
  setup_.service.setOpen(true);
  await settle();
  await settle();
  return setup_;
}

describe('startDesktopLyrics', () => {
  it('桌面动效独立保存并推送，重开后沿用所选预设', async () => {
    const { host, store, service, shared } = await opened();
    service.update({ motionPreset: 'winui' });
    await settle();
    expect(store.get(service.pref).motionPreset).toBe('winui');
    expect(parseDesktopLyricsView(await shared(DESKTOP_LYRICS_VIEW_KEY))?.motionPreset).toBe(
      'winui',
    );
    await vi.waitFor(() =>
      expect(host.config.get(PREF_KEY)).toMatchObject({ motionPreset: 'winui' }),
    );
    expect(host.config.has('defaultTheme.lyrics.motion')).toBe(false);
    service.dispose();
    const reopened = setup(Object.fromEntries(host.config));
    await reopened.service.ready;
    expect(reopened.store.get(reopened.service.pref).motionPreset).toBe('winui');
  });

  it('单行记住切换前的多行尺寸，切回时不被单行尺寸覆盖', async () => {
    const { host, store, service, fromPopup } = await opened();
    fromPopup({ type: 'mode', mode: 'single', bounds: { x: 20, y: 30, width: 800, height: 500 } });
    expect(store.get(service.pref)).toMatchObject({
      mode: 'single',
      multilineSize: { width: 800, height: 500 },
    });
    fromPopup({ type: 'mode', mode: 'multi', bounds: { x: 20, y: 30, width: 1100, height: 180 } });
    expect(store.get(service.pref)).toMatchObject({
      mode: 'multi',
      multilineSize: { width: 800, height: 500 },
      bounds: { x: 20, y: 30, width: 800, height: 500 },
    });
    service.setOpen(false);
    service.setOpen(true);
    await settle();
    expect(host.callsTo('window.createPopup').at(-1)).toMatchObject({
      x: 20,
      y: 30,
      width: 800,
      height: 500,
    });
  });

  it('跳转只接受当前歌词版本，单行、锁定及旧版本均不执行', async () => {
    const { store, service, lyricsState, seek, shared, fromPopup } = await opened();
    store.set(lyricsState, {
      status: 'ready',
      key: 'track',
      source: 'file',
      content: { kind: 'synced', lines: LINES },
    });
    await settle();
    const id = parseDesktopLyricsLines(await shared(DESKTOP_LYRICS_LINES_KEY))?.id;
    if (!id) throw new Error('缺少歌词版本');
    fromPopup({ type: 'seek', id, seconds: 6 });
    expect(seek).toHaveBeenLastCalledWith('track', 6);
    seek.mockClear();
    fromPopup({ type: 'seek', id: 'old', seconds: 6 });
    service.setLocked(true);
    fromPopup({ type: 'seek', id, seconds: 6 });
    service.setLocked(false);
    fromPopup({ type: 'mode', mode: 'single', bounds: { x: 0, y: 0, width: 640, height: 472 } });
    fromPopup({ type: 'seek', id, seconds: 6 });
    expect(seek).not.toHaveBeenCalled();
  });

  it('打开时先写好显示参数与歌词，再按预设建透明置顶的弹窗，并记下开着', async () => {
    const { host, store, service, lyricsState, shared } = setup();
    store.set(lyricsState, {
      status: 'ready',
      key: 't',
      source: 'file',
      content: { kind: 'synced', lines: LINES },
    });
    await service.ready;
    service.setOpen(true);
    await settle();
    await settle();
    const create = host.callsTo('window.createPopup')[0];
    expect(create).toMatchObject({
      url: 'desktop-lyrics.html',
      profile: 'desktopLyrics',
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
    });
    const writes = host.calls.map((call) => call.method);
    expect(writes.indexOf('state.set')).toBeLessThan(writes.indexOf('window.createPopup'));
    expect(parseDesktopLyricsView(await shared(DESKTOP_LYRICS_VIEW_KEY))).toMatchObject({
      align: 'center',
      fontSize: 34,
      sung: tealBrand[120],
      plate: true,
      title: 'Quiet Light',
      artist: 'Sample Artist',
    });
    expect(parseDesktopLyricsLines(await shared(DESKTOP_LYRICS_LINES_KEY))?.lines).toEqual([
      { ...LINES[0], words: [{ ...LINES[0]?.words[0], romanWord: '', obscene: false }] },
    ]);
    expect(store.get(service.state).status).toBe('open');
    await vi.waitFor(() => expect(host.config.get(PREF_KEY)).toMatchObject({ open: true }));
  });

  it('偏好里记着开着时，读回存档后就打开', async () => {
    const { host, service } = setup({ [PREF_KEY]: { open: true, locked: true } });
    await service.ready;
    await settle();
    expect(host.callsTo('window.createPopup')[0]).toMatchObject({ resizable: false });
  });

  it('建窗失败时记成关着并标出失败', async () => {
    const { host, store, service } = setup();
    host.answer('window.createPopup', hostFailure('OPERATION_FAILED'));
    await service.ready;
    service.setOpen(true);
    await settle();
    expect(store.get(service.state)).toMatchObject({ status: 'closed', failed: true });
  });

  it('只认自己弹窗发来的命令：校时按 0.1 秒累加，对齐轮换，锁定写进偏好', async () => {
    const { store, service, setOffset, fromPopup } = await opened();
    fromPopup({ type: 'offset', delta: 0.1 });
    fromPopup({ type: 'offset', delta: 0.1 });
    expect(setOffset).toHaveBeenLastCalledWith(0.2);
    fromPopup({ type: 'align' });
    expect(store.get(service.pref).align).toBe('right');
    fromPopup({ type: 'align' });
    expect(store.get(service.pref).align).toBe('left');
    fromPopup({ type: 'lock', locked: true }, 'someone-else');
    expect(store.get(service.pref).locked).toBe(false);
    fromPopup({ type: 'lock', locked: true });
    expect(store.get(service.pref).locked).toBe(true);
  });

  it('弹窗的关闭键关窗并记成关；宿主自己关掉弹窗时同样记成关', async () => {
    const first = await opened();
    first.fromPopup({ type: 'close' });
    expect(first.host.callsTo('window.closePopup')).toEqual([{ windowId: 'popup-1' }]);
    expect(first.store.get(first.service.pref).open).toBe(false);

    const second = await opened();
    second.host.emit('window:popupClosed', { windowId: 'popup-1' });
    expect(second.store.get(second.service.state).status).toBe('closed');
    expect(second.store.get(second.service.pref).open).toBe(false);
  });

  it('托盘的两行：一行开关，一行锁定', async () => {
    const { host, store, service } = setup();
    await service.ready;
    host.emit('tray:menuItemClicked', { id: TRAY_IDS.desktopLyrics });
    await settle();
    expect(host.callsTo('window.createPopup')).toHaveLength(1);
    host.emit('tray:menuItemClicked', { id: TRAY_IDS.desktopLyricsLock });
    expect(store.get(service.pref).locked).toBe(true);
  });

  it('热键被宿主拒收时标出来；换掉组合时先摘旧的', async () => {
    const { host, store, service } = setup();
    await service.ready;
    host.answer('keyboard.registerHotkey', hostFailure('OPERATION_FAILED'));
    expect(await service.setHotkey('toggle', 'Ctrl+Alt+L')).toBe(false);
    expect(store.get(service.state).hotkeyTaken.toggle).toBe(true);
    host.answer('keyboard.registerHotkey', { success: true, id: 2 });
    expect(await service.setHotkey('toggle', 'Ctrl+Alt+K')).toBe(true);
    expect(store.get(service.state).hotkeyTaken.toggle).toBe(false);
    expect(await service.setHotkey('toggle', '')).toBe(true);
    expect(host.callsTo('keyboard.unregisterHotkey').at(-1)).toEqual({ key: 'Ctrl+Alt+K' });
    host.emit('keyboard:hotkey', {
      id: 2,
      key: 'Ctrl+Alt+K',
      action: 'defaultTheme.desktopLyrics.toggle',
    });
    await settle();
    expect(host.callsTo('window.createPopup')).toHaveLength(1);
  });

  it('移回屏幕下方：开着时让弹窗自己挪，并忘掉记下的位置', async () => {
    const { host, store, service } = await opened({
      [PREF_KEY]: { bounds: { x: 10, y: 10, width: 640, height: 472 } },
    });
    service.resetPosition();
    await settle();
    expect(store.get(service.pref).bounds).toBeNull();
    expect(host.callsTo('window.sendMessage').at(-1)).toMatchObject({
      targetWindowId: 'popup-1',
      message: { command: { type: 'recenter' } },
    });
  });

  it('主窗口页面重载后认领开着的弹窗：不新建、不关掉，命令照收，共享状态重写一遍', async () => {
    const popupInfo = (windowId: string) => ({
      windowId,
      isMain: false,
      title: 'Desktop lyrics',
      url: `http://localhost:5190/desktop-lyrics.html?windowId=${windowId}`,
      profile: 'desktopLyrics' as const,
      behavior: {},
      resolvedBehavior: {
        showInTaskbar: false,
        showInAltTab: false,
        keepVisibleOnShowDesktop: true,
        allowMinimize: false,
        owner: 'none' as const,
        noActivate: true,
      },
      backdropPolicy: {},
      resolvedBackdropPolicy: {
        activeEffect: 'none' as const,
        inactiveEffect: 'inherit' as const,
        darkMode: true,
        reapplyOnActivate: false,
      },
      capabilities: {
        supportsBackdropPolicy: true,
        supportsFrameless: true,
        supportsCornerPreference: false,
        supportsPopupBehavior: true,
        supportsMicaAlt: false,
        supportsFullscreen: true,
      },
      bounds: { x: 0, y: 0, width: 640, height: 472 },
      shell: null,
    });
    const { host, store, service, fromPopup, shared } = setup({ [PREF_KEY]: { open: true } });
    host.answer('window.getAllWindows', {
      success: true,
      items: [popupInfo('popup_1'), popupInfo('popup_2')],
    });
    await service.ready;
    await settle();
    expect(host.callsTo('window.createPopup')).toHaveLength(0);
    expect(host.callsTo('window.closePopup')).toEqual([{ windowId: 'popup_2' }]);
    expect(store.get(service.state).status).toBe('open');
    expect(parseDesktopLyricsView(await shared(DESKTOP_LYRICS_VIEW_KEY))).not.toBeNull();
    fromPopup({ type: 'align' }, 'popup_1');
    expect(store.get(service.pref).align).toBe('right');
  });

  it('同一份歌词的 id 不随主窗口页面重载而变', async () => {
    let host: UnitHost | undefined;
    for (let page = 0; page < 2; page += 1) {
      const loaded = setup({}, host);
      host = loaded.host;
      const { store, service, lyricsState } = loaded;
      store.set(lyricsState, {
        status: 'ready',
        key: 't',
        source: 'file',
        content: { kind: 'synced', lines: LINES },
      });
      await service.ready;
      service.setOpen(true);
      await settle();
      service.dispose();
    }
    const ids = (host?.callsTo('state.set') ?? [])
      .filter((params) => params['key'] === DESKTOP_LYRICS_LINES_KEY)
      .map((params) => parseDesktopLyricsLines(params['value'])?.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });
});
