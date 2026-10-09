import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import {
  SEEK_IDLE,
  SEEK_SETTLE_MS,
  keySeek,
  secondsAt,
  settleWith,
  type SeekDraft,
} from '../../playback/seekDraft.ts';
import { swallowNextContextMenu } from '../../kit/swallowContextMenu.ts';
import type { SeekMotionIntent, SeekMotionKind } from './seekMotion.ts';

/** `PointerEvent.buttons` 里右键那一位。 */
const RIGHT_BUTTON = 2;

export interface SeekGestureOptions {
  /** 此刻能不能 seek；变成不能时，拖到一半的作废。 */
  readonly enabled: boolean;
  readonly duration: number;
  /** 宿主报的位置，秒。 */
  readonly position: number;
  /** 播放轮次改变时，旧拖动与等待交还的位置都作废，包括同一首重播。 */
  readonly generation: number;
  seek(seconds: number): Promise<void>;
  /** 拖动开始与结束（含放弃）。 */
  onDragChange?(dragging: boolean): void;
}

export interface SeekGesture {
  readonly draft: SeekDraft;
  readonly intent: SeekMotionIntent | null;
  /** 按下左键开始拖；松手才 seek。已经 preventDefault 的按下不接。 */
  press(event: PointerEvent<HTMLElement>): void;
  /** 拖动中就放弃这一次，答放没放弃。 */
  cancel(): boolean;
  /** 按键从最近的操作目标累加，不从尚未到位的动画位置计算。 */
  seekKey(key: string): void;
}

interface GestureFrame {
  readonly generation: number;
  readonly draft: SeekDraft;
  readonly intent: SeekMotionIntent | null;
  readonly acknowledged: boolean;
  readonly origin: number;
}

/**
 * 进度线的拖动：按住时显示拖到的位置、宿主的进度一概不理，松手才 seek，之后接着显示拖到的位置，等宿主报回的
 * 位置落到附近才交还（`seekDraft.ts`）。拖动中按下右键也是放弃，随后那次右键菜单吞掉。按下时量一次线的位置与
 * 宽，拖动中不再量：拖着的时候版式不变。
 */
export function useSeekGesture(options: SeekGestureOptions): SeekGesture {
  const { enabled, duration, position, generation } = options;
  const [frame, setFrame] = useState<GestureFrame>({
    generation,
    draft: SEEK_IDLE,
    intent: null,
    acknowledged: true,
    origin: position,
  });
  // 事件连续到达时React可能尚未重画，按键的下一步仍从刚才写入的目标计算。
  const current = useRef(frame);
  const sequence = useRef(0);
  const active = useRef(true);
  const cancelDrag = useRef<(() => void) | null>(null);
  const latest = useRef(options);
  // 右键取消拖动后，吞掉随后那次右键菜单的监听；卸下时摘掉。
  const unswallow = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const replace = useCallback((next: GestureFrame) => {
    current.current = next;
    setFrame(next);
  }, []);
  const change = useCallback(
    (draft: SeekDraft, kind?: SeekMotionKind) => {
      replace({
        generation: latest.current.generation,
        draft,
        intent: kind ? { sequence: ++sequence.current, kind } : current.current.intent,
        acknowledged: draft.phase !== 'settling',
        origin: latest.current.position,
      });
    },
    [replace],
  );

  // 轮次在渲染中收窄，旧目标不能在新曲目上短暂显示；宿主确认只交还数值，不重启正在播的定位动画。
  let visible = frame;
  if (frame.generation !== generation) {
    visible = { generation, draft: SEEK_IDLE, intent: null, acknowledged: true, origin: position };
    replace(visible);
  } else {
    // 跳转前的旧位置可能就在容差内，只有本次回读完成且位置已更新，才用它确认目标。
    const canSettle =
      frame.acknowledged &&
      (position !== frame.origin ||
        (frame.draft.phase === 'settling' && position === frame.draft.seconds));
    const settled = canSettle ? settleWith(frame.draft, position) : frame.draft;
    if (settled !== frame.draft) {
      visible = { ...frame, draft: settled };
      replace(visible);
    }
  }
  const { draft } = visible;

  useEffect(() => {
    if (draft.phase !== 'settling') return;
    const timer = setTimeout(() => {
      if (current.current.draft === draft) change(SEEK_IDLE, 'return');
    }, SEEK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [draft, change]);

  useLayoutEffect(() => {
    cancelDrag.current?.();
  }, [generation]);
  useLayoutEffect(() => {
    if (!enabled) cancelDrag.current?.();
  }, [enabled]);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancelDrag.current?.();
      unswallow.current?.();
    };
  }, []);

  const seekTo = (seconds: number, kind?: SeekMotionKind) => {
    const target: SeekDraft = { phase: 'settling', seconds };
    change(target, kind);
    void latest.current.seek(seconds).then(
      () => {
        if (active.current && current.current.draft === target)
          replace({ ...current.current, acknowledged: true });
      },
      () => {
        if (active.current && current.current.draft === target) change(SEEK_IDLE, 'return');
      },
    );
  };

  const press = (event: PointerEvent<HTMLElement>) => {
    // 外层已经 preventDefault 的按下归外层处理（触屏头一下只进悬停态），这里不接。
    if (!enabled || event.button !== 0 || cancelDrag.current || event.nativeEvent.defaultPrevented)
      return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const box = element.getBoundingClientRect();
    const at = (clientX: number) => secondsAt(clientX, box.left, box.width, duration);
    let seconds = at(event.clientX);
    event.preventDefault();
    element.focus();
    element.setPointerCapture(pointerId);
    change({ phase: 'dragging', seconds }, 'click');
    latest.current.onDragChange?.(true);
    const move = (moved: globalThis.PointerEvent) => {
      // 按着左键再按右键是取消：浏览器不为第二个键另发 pointerdown，只在 pointermove 里报多出来的键。
      if ((moved.buttons & RIGHT_BUTTON) !== 0) {
        unswallow.current?.();
        unswallow.current = swallowNextContextMenu();
        end(false);
        return;
      }
      if (moved.clientX === event.clientX && current.current.intent?.kind === 'click') return;
      seconds = at(moved.clientX);
      change({ phase: 'dragging', seconds }, 'drag');
    };
    const end = (commit: boolean) => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', drop);
      element.removeEventListener('lostpointercapture', drop);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      cancelDrag.current = null;
      if (generation !== latest.current.generation) change(SEEK_IDLE);
      else if (commit) seekTo(seconds);
      else change(SEEK_IDLE, 'return');
      latest.current.onDragChange?.(false);
    };
    const up = () => end(true);
    const drop = () => end(false);
    cancelDrag.current = drop;
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', drop);
    element.addEventListener('lostpointercapture', drop);
  };

  return {
    draft,
    intent: visible.intent,
    press,
    cancel() {
      if (!cancelDrag.current) return false;
      cancelDrag.current();
      return true;
    },
    seekKey(key) {
      const state = current.current;
      const source = state.draft.phase === 'idle' ? latest.current.position : state.draft.seconds;
      const seconds = keySeek(key, source, latest.current.duration);
      if (seconds === null || !latest.current.enabled) return;
      cancelDrag.current?.();
      seekTo(seconds, key === 'Home' ? 'home' : 'key');
    },
  };
}
