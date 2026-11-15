import { atom } from 'jotai/vanilla';
import { BROWSER_KEYS, type BrowserPanelService } from '../../nav/browserPanel.ts';
import type { CommandRegistry, KeyChord } from '../../nav/commandRegistry.ts';
import { FULLSCREEN_KEYS } from '../../nav/fullscreenCommand.ts';
import { currentTrackAtom, playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf, type PlaybackService } from '../../playback/playbackContract.ts';
import type { Store } from '../../kit/store.ts';
import type { ImmersiveShell } from './immersiveShell.ts';
import { focusKind, reclaimFocus, repeating } from './keyFocus.ts';
import { editOpenAtom, finishEdit } from './editSession.ts';

/**
 * 沉浸全屏视图按键映射，经命令登记处统一分派：
 * - Esc 退出视图。处于设置编辑态时优先完成编辑，浏览面板展开时优先收起面板
 * - 空格播放 / 暂停，← / → 后退 / 前进 `SEEK_STEP_SECONDS` 秒，↑ / ↓ 步进调节音量（步长由宿主决定）
 * - Ctrl+Shift+P 开关性能小窗，Ctrl+B 开关浏览面板，F11 切换宿主主窗全屏
 *
 * 全屏快捷键优先级高于全局绑定，与视图全屏按钮共享状态记录：在此处进入全屏后，退出视图时同步退出全屏
 * 空格与方向键无论是否带有 Shift 修饰均予响应，包含 Ctrl、Alt、Meta 时忽略，Esc 仅响应无修饰键的单键输入
 * 除 Esc 外的有效按键输入均视为一次用户交互，立即唤出控件层
 *
 * 焦点位于输入类控件时优先由控件自主处理：菜单、滑块与输入框直接处理方向键与空格输入。普通按钮仅在空格按下时触发自身点击
 * 焦点随 Tab 落在按钮上时，空格触发按钮行为。点击后焦点驻留于按钮时，空格仍执行播放 / 暂停
 * 空格键长按触发的键盘自动重复事件予以忽略，方向键的连续重复事件则持续执行定位跳转
 * 焦点位于视图外部（底层页面或外挂弹出层）时忽略按键。按键事件源与自动重复状态由 `keyFocus.ts` 挂载于根节点的跟踪器记录
 * 焦点脱落至 body 时，除 Esc 外的有效按键先将焦点收回视图根节点，以便准确识别长按重复
 *
 * Ctrl+Shift+P 依据 `event.key` 匹配（遵从命令登记处策略）而非物理键位，非拉丁键盘布局下该组合键可能无法匹配
 *
 * 连按方向键时从上一次的目标位置继续计算：宿主确认之前 `position` 仍是旧值
 * 目标位置落在 0 与时长之间。不能 seek 时忽略方向键
 */
export const SEEK_STEP_SECONDS = 5;
/** 宿主播放位置进入目标容差范围即视为完成定位。超时未确认（如定位失败）则恢复使用宿主当前位置 */
const CONFIRM_TOLERANCE_S = 1.5;
const CONFIRM_TIMEOUT_MS = 1000;

export interface ImmersiveKeysDeps {
  playback: Pick<PlaybackService, 'playOrPause' | 'seek' | 'stepVolume'>;
  store: Store;
  shell: Pick<ImmersiveShell, 'current' | 'leave' | 'touch' | 'toggleFullscreen'>;
  togglePerfOverlay: () => void;
  browser: Pick<BrowserPanelService, 'toggle' | 'open' | 'available'>;
}

const positionAtom = atom((get) => get(playbackAtom).position);
const trackKeyAtom = atom((get) => trackKeyOf(get(currentTrackAtom)));

const withShift = (key: string): KeyChord[] => [{ key }, { key, shift: true }];

/** 注册沉浸视图中的按键命令，返回统一注销函数。在视图挂载时调用，生命周期与外壳保持一致 */
export function registerImmersiveCommands(
  commands: CommandRegistry,
  deps: ImmersiveKeysDeps,
): () => void {
  const { playback, store, shell, browser } = deps;
  // 连续触发方向键时的目标位置（秒）。宿主确认、超时或切换曲目后重置
  let target: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function release(): void {
    clearTimeout(timer);
    timer = undefined;
    target = null;
  }

  function seekable(): boolean {
    const { status, canSeek, duration } = store.get(playbackAtom);
    return status === 'connected' && canSeek && duration > 0;
  }

  function seekBy(seconds: number): void {
    const { position, duration } = store.get(playbackAtom);
    const next = Math.min(Math.max((target ?? position) + seconds, 0), duration);
    target = next;
    clearTimeout(timer);
    timer = setTimeout(release, CONFIRM_TIMEOUT_MS);
    void playback.seek(next);
  }

  const notControl = () => {
    const kind = focusKind();
    return kind !== null && kind !== 'control';
  };

  const place = (id: string, keys: readonly KeyChord[], usable: () => boolean, run: () => void) =>
    commands.register({
      id: `immersive.${id}`,
      layer: 'place',
      keys,
      enabled: () => shell.current() && usable(),
      run: () => {
        reclaimFocus();
        shell.touch();
        run();
      },
    });

  const disposers = [
    commands.register({
      id: 'immersive.leave',
      layer: 'overlay',
      keys: [{ key: 'Escape' }],
      // 浏览面板展开时 Esc 归面板：它的收起命令登记在同一层，这里不依赖注册先后，窗口可见性变化会让这些命令重新注册
      enabled: () => shell.current() && !store.get(browser.open),
      run: () => shell.leave(),
    }),
    // 同层命令按后注册者优先匹配：编辑模式开启时 Esc 优先结束编辑（保留修改），再次按下退出视图。下拉框与内部菜单自主拦截 Esc
    commands.register({
      id: 'immersive.edit.finish',
      layer: 'overlay',
      keys: [{ key: 'Escape' }],
      enabled: () => shell.current() && store.get(editOpenAtom),
      run: () => finishEdit(store),
    }),
    place(
      'playPause',
      withShift(' '),
      () => focusKind() === 'free' && !repeating(),
      () => void playback.playOrPause(),
    ),
    place(
      'seekBack',
      withShift('ArrowLeft'),
      () => notControl() && seekable(),
      () => seekBy(-SEEK_STEP_SECONDS),
    ),
    place(
      'seekForward',
      withShift('ArrowRight'),
      () => notControl() && seekable(),
      () => seekBy(SEEK_STEP_SECONDS),
    ),
    place('volumeUp', withShift('ArrowUp'), notControl, () => void playback.stepVolume(true)),
    place('volumeDown', withShift('ArrowDown'), notControl, () => void playback.stepVolume(false)),
    place(
      'perfOverlay',
      [{ key: 'P', ctrl: true, shift: true }],
      () => true,
      deps.togglePerfOverlay,
    ),
    place(
      'fullscreen',
      FULLSCREEN_KEYS,
      () => true,
      () => void shell.toggleFullscreen(),
    ),
    // 编辑模式开启期间与浏览面板互斥，不响应切换命令
    place(
      'browser.toggle',
      BROWSER_KEYS.toggle,
      () => !store.get(editOpenAtom) && store.get(browser.available),
      browser.toggle,
    ),
    store.sub(positionAtom, () => {
      if (target !== null && Math.abs(store.get(positionAtom) - target) < CONFIRM_TOLERANCE_S) {
        release();
      }
    }),
    store.sub(trackKeyAtom, release),
  ];

  return () => {
    for (const dispose of disposers) dispose();
    release();
  };
}
