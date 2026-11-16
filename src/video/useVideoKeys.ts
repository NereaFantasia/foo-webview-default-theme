import type { RefObject } from 'react';
import type { CommandSpec, KeyChord, KeyInput } from '../nav/commandRegistry.ts';
import { FULLSCREEN_KEYS } from '../nav/fullscreenCommand.ts';
import { useCommand } from '../nav/useCommand.ts';
import { VIDEO_KEYS, VIDEO_SEEK_LONG_SECONDS, VIDEO_SEEK_SECONDS } from '../nav/videoKeys.ts';
import { PLAY_PAUSE_KEYS } from '../playback/playPauseCommand.ts';
import type { VideoBindings, VideoPlayback } from './videoContext.ts';

/**
 * 视频页的按键。焦点在页面里、且不在输入框、滑块、菜单与对话框里时才认领，这些控件自己处理方向键
 * 与字母；空格另要求页面根节点本身拿着焦点，焦点在按钮上时空格留给按钮
 */
export function useVideoKeys({
  active,
  available,
  root,
  bindings,
  playback,
  touch,
  collapse,
  toggleWindow,
  toggleFullscreen,
}: {
  readonly active: boolean;
  readonly available: boolean;
  readonly root: RefObject<HTMLElement | null>;
  readonly bindings: VideoBindings;
  readonly playback: VideoPlayback;
  readonly touch: () => void;
  readonly collapse: () => Promise<void>;
  readonly toggleWindow: () => void;
  readonly toggleFullscreen: () => Promise<void>;
}): void {
  const placeKeys = () => {
    const focused = document.activeElement;
    return (
      active &&
      !!focused &&
      !!root.current?.contains(focused) &&
      !focused.closest('input,textarea,select,[role="slider"],[role="menu"],[role="dialog"]')
    );
  };
  const connected = () => placeKeys() && playback.connected;
  const seekable = () => placeKeys() && playback.canSeek;
  const jumpable = () => seekable() && playback.duration > 0;
  /** 当前地点层的命令；认领后先唤出控件，再执行 */
  const place = (
    id: string,
    keys: readonly KeyChord[],
    enabled: () => boolean,
    run: (input?: KeyInput) => void,
  ): CommandSpec => ({
    id: `video.${id}`,
    layer: 'place',
    keys,
    enabled,
    run: (input) => {
      touch();
      run(input);
    },
  });

  useCommand({
    id: 'video.play',
    layer: 'place',
    keys: PLAY_PAUSE_KEYS,
    // 按住空格的自动重复不算，否则每个重复都切换一次播放状态
    enabled: (input) =>
      active &&
      playback.connected &&
      document.activeElement === root.current &&
      input?.repeat !== true,
    run: () => {
      touch();
      bindings.toggle();
    },
  });
  useCommand(place('volumeUp', VIDEO_KEYS.volumeUp, connected, () => bindings.stepVolume(true)));
  useCommand(
    place('volumeDown', VIDEO_KEYS.volumeDown, connected, () => bindings.stepVolume(false)),
  );
  useCommand(place('mute', VIDEO_KEYS.mute, connected, () => bindings.toggleMute()));
  useCommand(place('back', VIDEO_KEYS.back, seekable, () => bindings.seekBy(-VIDEO_SEEK_SECONDS)));
  useCommand(
    place('forward', VIDEO_KEYS.forward, seekable, () => bindings.seekBy(VIDEO_SEEK_SECONDS)),
  );
  useCommand(
    place('backLong', VIDEO_KEYS.backLong, seekable, () =>
      bindings.seekBy(-VIDEO_SEEK_LONG_SECONDS),
    ),
  );
  useCommand(
    place('forwardLong', VIDEO_KEYS.forwardLong, seekable, () =>
      bindings.seekBy(VIDEO_SEEK_LONG_SECONDS),
    ),
  );
  useCommand(
    place('jump', [...VIDEO_KEYS.start, ...VIDEO_KEYS.digits], jumpable, (input) => {
      const digit = input?.key === 'Home' ? 0 : Number(input?.key);
      if (Number.isInteger(digit)) bindings.seekTo((playback.duration * digit) / 10);
    }),
  );
  useCommand(place('previous', VIDEO_KEYS.previous, connected, () => bindings.previous()));
  useCommand(place('next', VIDEO_KEYS.next, connected, () => bindings.next()));
  useCommand(place('window', VIDEO_KEYS.window, () => placeKeys() && available, toggleWindow));
  // 没有画面可看时与全屏键一样不可用，F11 落到全局命令，只切换窗口的全屏；全窗口中照常认领，以便退出
  useCommand(
    place(
      'fullscreen',
      FULLSCREEN_KEYS,
      () => active && (available || bindings.expanded),
      () => void toggleFullscreen(),
    ),
  );
  useCommand({
    id: 'video.escape',
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    enabled: () =>
      active &&
      !root.current?.querySelector('[aria-expanded="true"]') &&
      !document.activeElement?.closest('[role="menu"],[role="dialog"]'),
    run: () => {
      if (bindings.expanded) void collapse();
      else bindings.close();
    },
  });
}
