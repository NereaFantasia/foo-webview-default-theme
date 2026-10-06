import { atom } from 'jotai/vanilla';
import type { CommandRegistry, KeyChord } from '../../nav/commandRegistry.ts';
import { FULLSCREEN_KEYS } from '../../nav/fullscreenCommand.ts';
import { currentTrackAtom, playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf, type PlaybackService } from '../../playback/playbackContract.ts';
import type { Store } from '../../kit/store.ts';
import type { ImmersiveShell } from './immersiveShell.ts';
import { focusKind, reclaimFocus, repeating } from './keyFocus.ts';

/**
 * 正在播放全屏页里的按键，经命令登记处分派：Esc 离开这一页；空格播放 / 暂停，← / → 后退 / 前进
 * `SEEK_STEP_SECONDS`，↑ / ↓ 音量升降一步（步长由 fb2k 定），Ctrl+Shift+P 开关性能小窗，F11 切换宿主主窗全屏。
 * F11 盖过全局那一条，与视图里的全屏键同一套记账：在这里进的全屏，离开这一页时一并退出。
 * 空格与方向键按不按 Shift 都认，带 Ctrl、Alt、Meta 的不认领；Esc 只认不带修饰键的。
 * 除 Esc 外认下的键都算一次动作，控件层随之回来。
 *
 * 焦点在输入控件上时让它自己处理：菜单、滑块、输入框吃方向键与空格；按钮只让出空格——键盘 Tab 到键上
 * 按空格是按这个键，鼠标点过、焦点留在键上时空格照样是播放 / 暂停。按住空格的自动重复不算，方向键的照跳。
 * 焦点在视图外（底下的页面、挂在视图外的弹出层）时这几个键都不认领。焦点从哪来、按键是不是自动重复，
 * 由 `keyFocus.ts` 挂在视图根元素上的跟踪器记下；焦点落在 body 上时，除 Esc 外认下的键先把焦点收回根元素，
 * 按住不放的重复才认得出。
 *
 * Ctrl+Shift+P 按 `event.key` 认（登记处的做法），不按物理键位：非拉丁键盘布局下这个组合可能认不出。
 *
 * 连按方向键时从上一次要去的位置接着算：宿主确认之前 `position` 还是旧的。落在 0 与时长之间；
 * 不能 seek 时方向键不认领。
 */
export const SEEK_STEP_SECONDS = 5;
/** 宿主位置落到目标这么近就算确认了 seek；迟迟不确认（seek 失败等）到点改回按宿主位置算。 */
const CONFIRM_TOLERANCE_S = 1.5;
const CONFIRM_TIMEOUT_MS = 1000;

export interface ImmersiveKeysDeps {
  playback: Pick<PlaybackService, 'playOrPause' | 'seek' | 'stepVolume'>;
  store: Store;
  shell: Pick<ImmersiveShell, 'current' | 'leave' | 'touch' | 'toggleFullscreen'>;
  togglePerfOverlay: () => void;
}

const positionAtom = atom((get) => get(playbackAtom).position);
const trackKeyAtom = atom((get) => trackKeyOf(get(currentTrackAtom)));

const withShift = (key: string): KeyChord[] => [{ key }, { key, shift: true }];

/** 登记视图里的按键命令，返回一次注销全部的函数。页面挂上时调，与壳同生命周期。 */
export function registerImmersiveCommands(
  commands: CommandRegistry,
  deps: ImmersiveKeysDeps,
): () => void {
  const { playback, store, shell } = deps;
  // 连按方向键时上一次要去的位置，秒；宿主确认、超时或换曲后清掉。
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
      enabled: () => shell.current(),
      run: () => shell.leave(),
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
