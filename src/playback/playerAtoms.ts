import { atom, type Atom } from 'jotai/vanilla';
import { currentTrackAtom, playbackAtom } from './playback.ts';
import type { PlaybackState } from './playbackContract.ts';

// 播放栏各件只读自己用到的那一项：`playbackAtom` 每 100 ms 随进度更新一次，整份读会让不看进度的键
// 也跟着重渲染。这里答的都是原始值，没变就不叫醒读它的组件。

/** 连上宿主了；没连上时播放栏的键一律置灰。 */
export const playbackConnectedAtom: Atom<boolean> = atom(
  (get) => get(playbackAtom).status === 'connected',
);

/** 有当前曲目（播着或暂停）；只在起播与停止时变，换曲不叫醒读它的组件。 */
export const hasCurrentTrackAtom: Atom<boolean> = atom((get) => get(currentTrackAtom) !== null);

export const playbackMutedAtom: Atom<boolean> = atom((get) => get(playbackAtom).muted);

/** 最近一次读取或命令失败了；重试或关掉提示后清掉。 */
export const playbackFailureAtom: Atom<PlaybackState['failure']> = atom(
  (get) => get(playbackAtom).failure,
);

/** 这一首的总长，秒；没有时长（网络流之类）是 0。 */
export const playbackDurationAtom: Atom<number> = atom((get) => get(playbackAtom).duration);

/** 宿主说这一首能不能 seek。 */
export const playbackCanSeekAtom: Atom<boolean> = atom((get) => get(playbackAtom).canSeek);
