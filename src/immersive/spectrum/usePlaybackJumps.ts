import { useStore } from 'jotai/react';
import { useEffect, useState } from 'react';
import { playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { createPositionGlide } from '../frame/positionGlide.ts';

/**
 * 播放内容的断点计数：同一首里位置跳了（seek，判法见 `positionGlide.ts`）或手动换曲时加一。频谱柱据此在断点之后
 * 让起音缓一小段，不让新内容一帧拍上去。
 *
 * 一首播完自然进下一首不算：上一首最后一拍停在末尾 `NATURAL_END_SECONDS` 以内就当自然接续，无缝播放时声音是连着的。
 * 时长未知（网络流）的换曲都算手动。
 */
export const NATURAL_END_SECONDS = 1.5;

/** 判断断点要看的一拍播放状态。 */
export interface JumpSample {
  /** 秒。 */
  readonly position: number;
  /** 秒；未知时为 0。 */
  readonly duration: number;
  readonly playing: boolean;
  /** 曲目身份（`trackKeyOf`）。 */
  readonly track: string;
}

export interface PlaybackJumps {
  /** 到目前为止的断点数。 */
  count(): number;
  /** 每有一个断点叫一次 `listener`；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

export interface JumpCounter extends PlaybackJumps {
  /**
   * 喂一拍，`now` 是单调时钟（毫秒）。位置、在不在播与曲目都和上一拍相同就不算新的一拍：同一拍晚些再喂，
   * 外推的锚点会被拨回那一拍。
   */
  sample(next: JumpSample, now: number): void;
}

export function createJumpCounter(): JumpCounter {
  const clock = createPositionGlide();
  const listeners = new Set<() => void>();
  let count = 0;
  let last: JumpSample | null = null;

  return {
    count: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sample(next, now) {
      if (
        last &&
        last.position === next.position &&
        last.playing === next.playing &&
        last.track === next.track
      ) {
        return;
      }
      const change = clock.sample({ seconds: next.position, live: next.playing }, next.track, now);
      const natural =
        change === 'track' &&
        last !== null &&
        last.duration > 0 &&
        last.position >= last.duration - NATURAL_END_SECONDS;
      last = next;
      if (!change || natural) return;
      count += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * 跟着 `playbackAtom` 数断点。返回的对象在组件的整个生命里不变，断点直接经 `subscribe` 通知，不引起重渲染；
 * 要按数值渲染的可以拿它配 `useSyncExternalStore`。
 */
export function usePlaybackJumps(): PlaybackJumps {
  const store = useStore();
  const [counter] = useState(createJumpCounter);

  useEffect(() => {
    const feed = (): void => {
      const { position, duration, state, track } = store.get(playbackAtom);
      counter.sample(
        { position, duration, playing: state === 'playing', track: trackKeyOf(track) },
        performance.now(),
      );
    };
    const off = store.sub(playbackAtom, feed);
    feed();
    return off;
  }, [store, counter]);

  return counter;
}
