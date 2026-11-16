import type { KeyChord } from './commandRegistry.ts';

/** 视频页方向键与按钮每次跳转的秒数 */
export const VIDEO_SEEK_SECONDS = 5;
/** 视频页 J、L 每次跳转的秒数 */
export const VIDEO_SEEK_LONG_SECONDS = 10;

const DIGITS: readonly KeyChord[] = Array.from({ length: 10 }, (_, digit) => ({
  key: String(digit),
}));

/** 视频页的按键。视频页与设置里的快捷键一览共用这一份 */
export const VIDEO_KEYS = {
  volumeUp: [{ key: 'ArrowUp' }],
  volumeDown: [{ key: 'ArrowDown' }],
  mute: [{ key: 'm' }],
  back: [{ key: 'ArrowLeft' }],
  forward: [{ key: 'ArrowRight' }],
  backLong: [{ key: 'j' }],
  forwardLong: [{ key: 'l' }],
  /** Home 回到开头；数字 n 跳到时长的 n0% 处 */
  start: [{ key: 'Home' }],
  digits: DIGITS,
  previous: [{ key: 'p', shift: true }],
  next: [{ key: 'n', shift: true }],
  window: [{ key: 'f' }],
} as const satisfies Record<string, readonly KeyChord[]>;
