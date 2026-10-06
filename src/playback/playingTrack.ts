import { atom, type Atom } from 'jotai/vanilla';
import { playbackAtom } from './playback.ts';
import { trackKeyOf } from './playbackContract.ts';

// 逐行标出正在播放那一首的界面读这两个原子。答的都是原始值，播放进度每 100 ms 一次的更新
// 不会叫醒读它们的组件。

/** 装载着的曲目，按 `trackKeyOf` 的口径（路径加 subsong）；停止或没有曲目时是空串，暂停时照样有值。 */
export const playingTrackKeyAtom: Atom<string> = atom((get) => {
  const { track, state } = get(playbackAtom);
  return state === 'stopped' ? '' : trackKeyOf(track);
});

/** 正在出声；暂停与停止时为假。 */
export const playingAudibleAtom: Atom<boolean> = atom(
  (get) => get(playbackAtom).state === 'playing',
);
