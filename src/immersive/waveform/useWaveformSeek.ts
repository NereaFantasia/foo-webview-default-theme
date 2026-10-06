import { useAtomValueRawSync, useStore } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useCommand } from '../../nav/useCommand.ts';
import { playbackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { SEEK_IDLE, SEEK_SETTLE_MS, settleWith, type SeekDraft } from '../../playback/seekDraft.ts';
import { swallowNextContextMenu } from '../../kit/swallowContextMenu.ts';
import type { Store } from '../../kit/store.ts';
import { secondsAt } from './waveformColumns.ts';

/**
 * 整轨波形上的 seek 手势，与播放栏的进度线同一口径（`seekDraft.ts`）：按下起草稿，拖动中播放头跟指针走、
 * 不理宿主报的位置；松手才 seek，之后在宿主确认前接着显示目标位置，否则松手那一帧播放头会先跳回去。
 * 拖动中按 Esc 或按下右键放弃这一次，回到宿主位置；右键放弃后紧跟的那次右键菜单吞掉。不能 seek 时按下不响应。
 *
 * Esc 登记在 `gesture` 层、只在拖动中认领，先于视图在 `overlay` 层的离开。草稿与待确认的目标不进 React 状态：
 * 播放头在帧回调里经 `seconds()` 现读，变了由 `subscribe` 通知。换曲、卸下时拖到一半的作废，指针捕获随之释放。
 */

/** `PointerEvent.buttons` 里右键那一位。 */
const RIGHT_BUTTON = 2;

// 连上宿主、这一首能 seek、有时长；派生成布尔，100 ms 一次的进度更新不叫醒波形。
const seekableAtom = atom((get) => {
  const { status, canSeek, duration } = get(playbackAtom);
  return status === 'connected' && canSeek && duration > 0;
});

export interface WaveformSeekGesture {
  /** 播放头该在的秒数：拖动中的草稿、待确认的目标、宿主位置（不超过曲长），依次取第一个有的。 */
  seconds(): number;
  /** 显示的是宿主位置，不是草稿也不是待确认的目标：在播时可以按墙钟外推。 */
  following(): boolean;
  dragging(): boolean;
  /** 草稿或待确认的目标变了就叫 `listener`；返回退订。 */
  subscribe(listener: () => void): () => void;
  /** 波形带上按下：左键开始拖，别的键不理。 */
  press(event: PointerEvent<HTMLElement>): void;
  /** 拖动中就放弃这一次，不在拖时什么也不做。 */
  cancel(): void;
}

export interface WaveformSeek {
  /** 为假时按下不响应，光标也不变。 */
  readonly seekable: boolean;
  /** 挂载期间始终是同一个对象，可以放进 effect 的依赖。 */
  readonly gesture: WaveformSeekGesture;
}

interface GestureCore extends WaveformSeekGesture {
  /** 宿主报来新的状态：换曲作废草稿，位置落到目标附近就交还。 */
  follow(): void;
  dispose(): void;
}

function createGesture(store: Store, seek: (seconds: number) => void): GestureCore {
  let draft: SeekDraft = SEEK_IDLE;
  // 草稿属于哪一首：换曲那一拍里草稿还没作废时，先读到新状态的人不会把上一首的位置当成这一首的。
  let draftTrack = '';
  let track = trackKeyOf(store.get(playbackAtom).track);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let stopDrag: ((commit: boolean) => void) | null = null;
  let unswallow: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const currentTrack = (): string => trackKeyOf(store.get(playbackAtom).track);
  const drafted = (): boolean => draft.phase !== 'idle' && draftTrack === currentTrack();

  function set(next: SeekDraft): void {
    if (next === draft) return;
    draft = next;
    draftTrack = currentTrack();
    clearTimeout(settleTimer);
    // 宿主迟迟不确认（seek 失败等）时到点交还宿主的位置。
    settleTimer =
      next.phase === 'settling' ? setTimeout(() => set(SEEK_IDLE), SEEK_SETTLE_MS) : undefined;
    for (const listener of [...listeners]) listener();
  }

  function press(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || stopDrag || !store.get(seekableAtom)) return;
    const element = event.currentTarget;
    const { pointerId } = event;
    const at = (clientX: number): number => {
      const box = element.getBoundingClientRect();
      return secondsAt(clientX - box.left, box.width, store.get(playbackAtom).duration);
    };
    const move = (moved: globalThis.PointerEvent): void => {
      // 按着左键再按右键是放弃：浏览器不为第二个键另发 pointerdown，只在 pointermove 里报多出来的键。
      if ((moved.buttons & RIGHT_BUTTON) !== 0) {
        unswallow?.();
        unswallow = swallowNextContextMenu();
        end(false);
        return;
      }
      set({ phase: 'dragging', seconds: at(moved.clientX) });
    };
    const up = (): void => end(true);
    const drop = (): void => end(false);
    // 先摘掉拖动态再改草稿：听的人要读到「不在拖了」，放弃拖动回到宿主位置才会滑回去。
    const end = (commit: boolean): void => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', drop);
      element.removeEventListener('lostpointercapture', drop);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      stopDrag = null;
      if (commit && draft.phase === 'dragging') {
        const target = draft.seconds;
        set({ phase: 'settling', seconds: target });
        seek(target);
      } else {
        set(SEEK_IDLE);
      }
    };
    element.setPointerCapture(pointerId);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', drop);
    element.addEventListener('lostpointercapture', drop);
    stopDrag = end;
    set({ phase: 'dragging', seconds: at(event.clientX) });
  }

  return {
    seconds() {
      if (draft.phase !== 'idle' && draftTrack === currentTrack()) return draft.seconds;
      const { position, duration } = store.get(playbackAtom);
      return Math.min(position, duration);
    },
    following: () => !drafted(),
    dragging: () => stopDrag !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    press,
    cancel: () => stopDrag?.(false),
    follow() {
      const { track: playing, position } = store.get(playbackAtom);
      const key = trackKeyOf(playing);
      if (key !== track) {
        // 换曲时拖到一半的与等着确认的都属于上一首。
        track = key;
        stopDrag?.(false);
        set(SEEK_IDLE);
        return;
      }
      set(settleWith(draft, position));
    },
    dispose() {
      stopDrag?.(false);
      unswallow?.();
      unswallow = null;
      clearTimeout(settleTimer);
      settleTimer = undefined;
      draft = SEEK_IDLE;
    },
  };
}

/** `seek` 收秒数，每次渲染取最近传进来的那个。 */
export function useWaveformSeek(seek: (seconds: number) => void): WaveformSeek {
  const store = useStore();
  const seekable = useAtomValueRawSync(seekableAtom);
  const latest = useRef(seek);
  useLayoutEffect(() => {
    latest.current = seek;
  });
  const [gesture] = useState(() => createGesture(store, (seconds) => latest.current(seconds)));

  useEffect(() => {
    const off = store.sub(playbackAtom, gesture.follow);
    gesture.follow();
    return () => {
      off();
      gesture.dispose();
    };
  }, [store, gesture]);

  useCommand({
    id: 'immersive.waveform.cancelSeek',
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: gesture.dragging,
    run: gesture.cancel,
  });

  return { seekable, gesture };
}
