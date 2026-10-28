import type { BrandVariants } from '@fluentui/react-components';
import type { LyricLine } from '@applemusic-like-lyrics/core';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import {
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../../host/configPref.ts';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { hostCommand, settle } from '../../host/hostCall.ts';
import { readScreen } from '../../host/miniPlacement.ts';
import type { Translate } from '../../i18n/translate.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { Store } from '../../kit/store.ts';
import { TRAY_IDS } from '../../playback/trayMenu.ts';
import { lyricsVersion } from '../lyricsArchive.ts';
import type { LyricsService } from '../lyricsService.ts';
import {
  DESKTOP_LYRICS_LINES_KEY,
  DESKTOP_LYRICS_VIEW_KEY,
  desktopLyricsMessage,
  desktopLyricsViewJson,
  parseDesktopLyricsMessage,
  type DesktopLyricsCommand,
  type DesktopLyricsView,
} from './desktopLyricsLink.ts';
import {
  DESKTOP_LYRICS_ALIGNS,
  DESKTOP_LYRICS_FONT_SIZES,
  DESKTOP_LYRICS_HOTKEYS,
  DESKTOP_LYRICS_PREF,
  desktopLyricsConfig,
  desktopLyricsPrefAtom,
  parseDesktopLyricsPref,
  type DesktopLyricsAlign,
  type DesktopLyricsBounds,
  type DesktopLyricsHotkey,
  type DesktopLyricsPref,
} from './desktopLyricsPrefs.ts';

export interface DesktopLyricsFace extends ConfigPrefFace {
  on: typeof fb.on;
  ui: Pick<typeof fb.ui, 'createPopup' | 'closePopup' | 'getAllWindows' | 'sendMessage' | 'focus'>;
  sharedState: Pick<typeof fb.sharedState, 'set'>;
  keyboard: Pick<typeof fb.keyboard, 'registerHotkey' | 'unregisterHotkey'>;
}

export interface DesktopLyricsDeps {
  readonly lyrics: Pick<LyricsService, 'state' | 'offset' | 'setOffset'> & {
    seek(key: string, seconds: number): Promise<void>;
  };
  readonly track: Atom<{ readonly title: string; readonly artist: string } | null>;
  /** 跟随主题与封面的强调色 ramp */
  readonly ramp: Atom<BrandVariants>;
  /** 主窗口在前台，且右侧卡或沉浸视图正显示歌词 */
  readonly shown: Atom<boolean>;
  readonly translate: Atom<Translate>;
  readonly writer: Pick<ConfigWriter, 'set'>;
  /** 弹窗页相对站点根的路径；缺省按当前页面的地址算，与主窗口同一个版本目录 */
  readonly page?: string;
}

export interface DesktopLyricsState {
  /** 弹窗状态：`opening` 为异步创建往返途中 */
  readonly status: 'closed' | 'opening' | 'open';
  /** 标记上一次窗口创建是否失败 */
  readonly failed: boolean;
  /** 快捷键注册冲突标记（若为 true 说明对应全局组合键已被系统其他进程占用） */
  readonly hotkeyTaken: Readonly<Record<DesktopLyricsHotkey, boolean>>;
}

export interface DesktopLyricsService {
  readonly state: Atom<DesktopLyricsState>;
  readonly pref: Atom<DesktopLyricsPref>;
  readonly persistence: ConfigPersistence;
  /** 打开设置请求计数原子（主窗口据此跳转至设置页「歌词」分组） */
  readonly settingsRequests: Atom<number>;
  readonly ready: Promise<void>;
  setOpen(open: boolean): void;
  toggle(): void;
  setLocked(locked: boolean): void;
  setAlign(align: DesktopLyricsAlign): void;
  /** 更新显示参数；开关、锁定、位置及快捷键独立封装 */
  update(patch: Partial<DesktopLyricsPref>): void;
  /** 开启状态下重置窗口至当前屏幕底部居中，关闭状态下清空已记录的坐标 */
  resetPosition(): void;
  /** 设置或清空全局快捷键（传入空字符串即清除），返回宿主是否注册成功 */
  setHotkey(name: DesktopLyricsHotkey, chord: string): Promise<boolean>;
  openSettings(): void;
  dispose(): void;
}

export const desktopLyricsKey = serviceKey<DesktopLyricsService>('desktopLyrics');

/** 缺省窗口尺寸：工具栏 48px + 歌词区 424px（CSS 像素） */
const DEFAULT_SIZE = { width: 640, height: 472 };
/** 窗口底边与工作区底部的边距（CSS 像素） */
const BOTTOM_GAP = 48;
/** 已播放歌词高亮色取色阶 step 120，染色底板取色阶 step 30（设置页缺省值对齐该基准） */
export const DESKTOP_LYRICS_SUNG_STEP = 120;
export const DESKTOP_LYRICS_TINT_STEP = 30;
const HOTKEY_ACTIONS: Readonly<Record<DesktopLyricsHotkey, string>> = {
  toggle: 'defaultTheme.desktopLyrics.toggle',
  lock: 'defaultTheme.desktopLyrics.lock',
};
const NO_HOTKEY_FAILURE = { toggle: false, lock: false };

function pagePath(): string {
  return new URL('desktop-lyrics.html', location.href).pathname.replace(/^\/+/, '');
}

/** 主窗口所在屏幕底部居中位置（物理像素）；屏幕读取失败返回 null */
function defaultBounds(): DesktopLyricsBounds | null {
  const view = readScreen();
  if (!view) return null;
  const ratio = globalThis.devicePixelRatio || 1;
  const { work } = view;
  return {
    x: Math.round((work.left + (work.right - work.left - DEFAULT_SIZE.width) / 2) * ratio),
    y: Math.round((work.bottom - DEFAULT_SIZE.height - BOTTOM_GAP) * ratio),
    width: Math.round(DEFAULT_SIZE.width * ratio),
    height: Math.round(DEFAULT_SIZE.height * ratio),
  };
}

/** 32 位 FNV-1a 哈希（十六进制）：用于歌词版本轻量标识 */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** 将播放器歌词行对象转换为纯 JSON 结构（共享状态仅接收标准 JSON） */
function linesJson(lines: readonly LyricLine[]) {
  return lines.map((line) => ({
    startTime: line.startTime,
    endTime: line.endTime,
    translatedLyric: line.translatedLyric,
    romanLyric: line.romanLyric,
    isBG: line.isBG,
    isDuet: line.isDuet,
    words: line.words.map((word) => ({
      word: word.word,
      startTime: word.startTime,
      endTime: word.endTime,
      romanWord: word.romanWord ?? '',
      obscene: word.obscene ?? false,
      ...(word.ruby
        ? {
            ruby: word.ruby.map(({ word: text, startTime, endTime }) => ({
              word: text,
              startTime,
              endTime,
            })),
          }
        : {}),
    })),
  }));
}

/**
 * 主窗口桌面歌词协调服务：
 * 管理独立桌面歌词弹窗的开合、锁定及外观偏好（持久化于 `defaultTheme.desktopLyrics`），
 * 并通过共享状态下发歌词与视图参数；监听弹窗消息、托盘交互与全局系统快捷键
 * 偏好记录为开启时在启动后自动呼出弹窗；宿主或用户关闭弹窗时联动更新状态
 */
export function startDesktopLyrics(
  store: Store,
  deps: DesktopLyricsDeps,
  host: DesktopLyricsFace = fb,
): DesktopLyricsService {
  const prefs = startConfigPrefs(store, [DESKTOP_LYRICS_PREF], host, deps.writer);
  const state = atom<DesktopLyricsState>({
    status: 'closed',
    failed: false,
    hotkeyTaken: NO_HOTKEY_FAILURE,
  });
  const settingsRequests = atom(0);
  let disposed = false;
  let popup: string | null = null;
  let opening = 0;
  let pushQueued = false;
  let sentView = '';
  let sentLines: readonly LyricLine[] | null | undefined;
  const registered: Record<DesktopLyricsHotkey, string> = { toggle: '', lock: '' };
  let hotkeys = Promise.resolve();
  const offs: (() => void)[] = [];

  const pref = () => store.get(desktopLyricsPrefAtom);
  const patchState = (patch: Partial<DesktopLyricsState>) => {
    if (!disposed) store.set(state, { ...store.get(state), ...patch });
  };
  function save(patch: Partial<DesktopLyricsPref>): void {
    if (disposed) return;
    void prefs.set(DESKTOP_LYRICS_PREF, desktopLyricsConfig({ ...pref(), ...patch }));
  }

  function currentLines(): readonly LyricLine[] | null {
    const current = store.get(deps.lyrics.state);
    return current.status === 'ready' && current.content.kind === 'synced'
      ? current.content.lines
      : null;
  }

  /** 综合曲目与歌词内容版本生成轻量唯一标识；重载后弹窗已持有同版本数据时不重复提交 */
  function linesId(): string {
    const current = store.get(deps.lyrics.state);
    return current.status === 'ready'
      ? `${shortHash(current.key)}:${shortHash(lyricsVersion(current))}`
      : 'none';
  }

  function view(): DesktopLyricsView {
    const p = pref();
    const ramp = store.get(deps.ramp);
    const t = store.get(deps.translate);
    const track = store.get(deps.track);
    const accent = ramp[DESKTOP_LYRICS_SUNG_STEP];
    return {
      labels: {
        previous: t('player.previous'),
        play: t('player.play'),
        pause: t('player.pause'),
        next: t('player.next'),
        earlier: t('desktopLyrics.earlier'),
        later: t('desktopLyrics.later'),
        align: t('desktopLyrics.alignCycle'),
        mode: t(p.mode === 'multi' ? 'desktopLyrics.toSingle' : 'desktopLyrics.toMulti'),
        lock: t('desktopLyrics.lock'),
        unlock: t('desktopLyrics.unlock'),
        settings: t('desktopLyrics.settings'),
        close: t('desktopLyrics.close'),
      },
      locked: p.locked,
      align: p.align,
      motionPreset: p.motionPreset,
      mode: p.mode,
      multilineSize: p.multilineSize,
      fontSize: DESKTOP_LYRICS_FONT_SIZES[p.size],
      sung: p.palette === 'white' ? null : p.palette === 'custom' ? p.sungColor || accent : accent,
      unsung: p.palette === 'custom' ? p.unsungColor || null : null,
      tint: p.plateTint ? ramp[DESKTOP_LYRICS_TINT_STEP] : null,
      plate: p.background === 'plate',
      plateOpacity: p.plateOpacity,
      glow: p.glowColor || null,
      showTranslation: p.showTranslation,
      showRomanization: p.showRomanization,
      offset: store.get(deps.lyrics.offset),
      title: track?.title ?? '',
      artist: track?.artist ?? '',
      hidden: p.autoHide && store.get(deps.shown),
    };
  }

  /** 合并同一事件循环内的多处变更，内容无变动时跳过更新 */
  function push(): void {
    pushQueued = false;
    if (disposed || store.get(state).status === 'closed') return;
    const next = view();
    const text = JSON.stringify(next);
    if (text !== sentView) {
      sentView = text;
      void settle(() => host.sharedState.set(DESKTOP_LYRICS_VIEW_KEY, desktopLyricsViewJson(next)));
    }
    const lines = currentLines();
    if (lines !== sentLines) {
      sentLines = lines;
      const id = lines ? linesId() : 'none';
      void settle(() =>
        host.sharedState.set(DESKTOP_LYRICS_LINES_KEY, { id, lines: lines && linesJson(lines) }),
      );
    }
  }

  function schedulePush(): void {
    if (pushQueued || disposed) return;
    pushQueued = true;
    queueMicrotask(push);
  }

  async function open(): Promise<void> {
    if (disposed || store.get(state).status !== 'closed') return;
    const mine = ++opening;
    patchState({ status: 'opening', failed: false });
    // 弹窗创建前预先写入共享状态，确保新窗口初始化时即可同步最新歌词数据
    sentView = '';
    sentLines = undefined;
    push();
    const p = pref();
    const bounds = p.bounds ?? defaultBounds();
    const answer = await settle(() =>
      host.ui.createPopup({
        url: deps.page ?? pagePath(),
        title: store.get(deps.translate)('desktopLyrics.title'),
        profile: 'desktopLyrics',
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: !p.locked && p.mode === 'multi',
        ...(bounds ?? {}),
      }),
    );
    if (disposed || mine !== opening) {
      if (answer?.success) void hostCommand(() => host.ui.closePopup(answer.windowId));
      return;
    }
    if (!answer || answer.success === false) {
      patchState({ status: 'closed', failed: true });
      if (pref().open) save({ open: false });
      return;
    }
    popup = answer.windowId;
    patchState({ status: 'open' });
    if (!pref().open) save({ open: true });
  }

  function close(): void {
    opening += 1;
    const id = popup;
    popup = null;
    patchState({ status: 'closed' });
    if (pref().open) save({ open: false });
    if (id) void hostCommand(() => host.ui.closePopup(id));
  }

  function setOpen(next: boolean): void {
    if (disposed) return;
    if (next) void open();
    else close();
  }

  function setLocked(locked: boolean): void {
    if (pref().locked !== locked) save({ locked });
  }

  function handle(command: DesktopLyricsCommand): void {
    switch (command.type) {
      case 'seek': {
        const current = store.get(deps.lyrics.state);
        if (
          pref().mode === 'multi' &&
          !pref().locked &&
          !view().hidden &&
          current.status === 'ready' &&
          command.id === linesId()
        )
          void deps.lyrics.seek(current.key, command.seconds);
        return;
      }
      case 'mode': {
        if (pref().locked || command.mode === pref().mode) return;
        const { width, height } = command.bounds;
        const restored = command.mode === 'multi' ? pref().multilineSize : null;
        save({
          mode: command.mode,
          bounds: { ...command.bounds, ...restored },
          ...(command.mode === 'single' ? { multilineSize: { width, height } } : {}),
        });
        return;
      }
      case 'offset': {
        const next = Math.round((store.get(deps.lyrics.offset) + command.delta) * 10) / 10;
        void deps.lyrics.setOffset(next);
        return;
      }
      case 'align': {
        const at = DESKTOP_LYRICS_ALIGNS.indexOf(pref().align);
        save({ align: DESKTOP_LYRICS_ALIGNS[(at + 1) % DESKTOP_LYRICS_ALIGNS.length] });
        return;
      }
      case 'lock':
        setLocked(command.locked);
        return;
      case 'close':
        close();
        return;
      case 'settings':
        service.openSettings();
        return;
      case 'bounds':
        save({ bounds: command.bounds });
        return;
      case 'recenter':
        return;
    }
  }

  /** 注册或注销全局快捷键；若存在已绑定的组合键先注销，以清空上个实例可能残留的宿主登记 */
  async function applyHotkey(name: DesktopLyricsHotkey): Promise<boolean> {
    const chord = disposed ? '' : pref().hotkeys[name];
    if (registered[name] === chord) return !store.get(state).hotkeyTaken[name];
    if (registered[name]) {
      const old = registered[name];
      registered[name] = '';
      await settle(() => host.keyboard.unregisterHotkey({ key: old }));
    }
    let ok = true;
    if (chord) {
      await settle(() => host.keyboard.unregisterHotkey({ key: chord }));
      ok = await hostCommand(() => host.keyboard.registerHotkey(chord, HOTKEY_ACTIONS[name]));
      if (ok) registered[name] = chord;
    }
    patchState({ hotkeyTaken: { ...store.get(state).hotkeyTaken, [name]: !ok } });
    return ok;
  }
  function queueHotkey(name: DesktopLyricsHotkey): Promise<boolean> {
    const task = hotkeys.then(() => applyHotkey(name));
    hotkeys = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  const service: DesktopLyricsService = {
    state: atom((get) => get(state)),
    pref: desktopLyricsPrefAtom,
    persistence: prefs,
    settingsRequests: atom((get) => get(settingsRequests)),
    ready: prefs.ready.then(async () => {
      if (disposed || !host.isAvailable()) return;
      offs.push(
        host.on('window:message', ({ sourceWindowId, message }) => {
          if (sourceWindowId !== popup) return;
          const command = parseDesktopLyricsMessage(message);
          if (command) handle(command);
        }),
        host.on('window:popupClosed', ({ windowId }) => {
          if (windowId !== popup) return;
          popup = null;
          patchState({ status: 'closed' });
          if (pref().open) save({ open: false });
        }),
        host.on('tray:menuItemClicked', ({ id }) => {
          if (id === TRAY_IDS.desktopLyrics) service.toggle();
          else if (id === TRAY_IDS.desktopLyricsLock) setLocked(!pref().locked);
        }),
        host.on('keyboard:hotkey', ({ action }) => {
          if (action === HOTKEY_ACTIONS.toggle) service.toggle();
          else if (action === HOTKEY_ACTIONS.lock && store.get(state).status !== 'closed')
            setLocked(!pref().locked);
        }),
      );
      for (const name of DESKTOP_LYRICS_HOTKEYS) void queueHotkey(name);
      if (!pref().open) return;
      // 主窗口重载时不销毁弹窗，直接认领已存在的弹窗实例并同步共享状态，避免弹窗闪烁；超出单个的冗余窗口关闭
      const windows = await settle(() => host.ui.getAllWindows());
      if (disposed || store.get(state).status !== 'closed') return;
      const [kept, ...extra] = (windows?.success ? windows.items : []).filter(
        (item) => !item.isMain && item.url.includes('desktop-lyrics.html'),
      );
      for (const item of extra) void hostCommand(() => host.ui.closePopup(item.windowId));
      if (!kept) {
        void open();
        return;
      }
      popup = kept.windowId;
      patchState({ status: 'open' });
      sentView = '';
      sentLines = undefined;
      push();
    }),
    setOpen,
    toggle: () => setOpen(store.get(state).status === 'closed'),
    setLocked,
    setAlign: (align) => save({ align }),
    update(patch) {
      const { open, locked, bounds, mode, multilineSize, hotkeys: keys } = pref();
      save(
        parseDesktopLyricsPref({
          ...pref(),
          ...patch,
          open,
          locked,
          bounds,
          mode,
          multilineSize,
          hotkeys: keys,
        }),
      );
    },
    resetPosition() {
      save({ bounds: null });
      const id = popup;
      if (id)
        void settle(() => host.ui.sendMessage(id, desktopLyricsMessage({ type: 'recenter' })));
    },
    async setHotkey(name, chord) {
      save({ hotkeys: { ...pref().hotkeys, [name]: chord } });
      return queueHotkey(name);
    },
    openSettings() {
      if (disposed) return;
      void hostCommand(() => host.ui.focus());
      store.set(settingsRequests, store.get(settingsRequests) + 1);
    },
    dispose() {
      disposed = true;
      opening += 1;
      for (const off of offs.splice(0)) off();
      for (const name of DESKTOP_LYRICS_HOTKEYS) {
        const key = registered[name];
        if (key) void settle(() => host.keyboard.unregisterHotkey({ key }));
      }
      prefs.dispose();
    },
  };

  offs.push(
    ...[
      desktopLyricsPrefAtom,
      deps.lyrics.state,
      deps.lyrics.offset,
      deps.track,
      deps.ramp,
      deps.shown,
      deps.translate,
    ].map((input) => store.sub(input, schedulePush)),
  );
  return service;
}
