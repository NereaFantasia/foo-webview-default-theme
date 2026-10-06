import { atom, type Atom } from 'jotai/vanilla';
import { playbackAtom } from '../../playback/playback.ts';
import { MISSING, formatDuration, formatRemaining } from '../paper/paperScale.ts';

// 三行字都按整秒变：派生成字符串，100 ms 一次的进度更新只在字变了时叫醒读它们的格子。
// Duration、Elapsed 与剩余时间用同一种写法（一小时以上照样进位到分钟位），几行对得上。

/** 曲目总长；没有曲目或宿主报不出时长（网络流）写 `—`。 */
export const durationTextAtom: Atom<string> = atom((get) => {
  const { track, duration } = get(playbackAtom);
  return track && duration > 0 ? formatDuration(duration) : MISSING;
});

/** 已播时间；没有曲目写 `—`。 */
export const elapsedTextAtom: Atom<string> = atom((get) => {
  const { track, position } = get(playbackAtom);
  return track ? formatDuration(position) : MISSING;
});

/** 剩余时间；没有曲目写 `—`。 */
export const remainingTextAtom: Atom<string> = atom((get) => {
  const { track, duration, position } = get(playbackAtom);
  return track ? formatRemaining(duration, position) : MISSING;
});
