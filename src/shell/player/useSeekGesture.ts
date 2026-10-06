import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import {
  SEEK_IDLE,
  SEEK_SETTLE_MS,
  secondsAt,
  settleWith,
  type SeekDraft,
} from '../../playback/seekDraft.ts';
import { swallowNextContextMenu } from '../../kit/swallowContextMenu.ts';

/** `PointerEvent.buttons` 里右键那一位。 */
const RIGHT_BUTTON = 2;

export interface SeekGestureOptions {
  /** 此刻能不能 seek；变成不能时，拖到一半的作废。 */
  readonly enabled: boolean;
  readonly duration: number;
  /** 宿主报的位置，秒。 */
  readonly position: number;
  /** 这一首的身份；换了一首，拖到一半的与等着交还的都作废。 */
  readonly trackKey: string;
  seek(seconds: number): void;
  /** 拖动开始与结束（含放弃）。 */
  onDragChange?(dragging: boolean): void;
}

export interface SeekGesture {
  readonly draft: SeekDraft;
  /** 按下左键开始拖；松手才 seek。已经 preventDefault 的按下不接。 */
  press(event: PointerEvent<HTMLElement>): void;
  /** 拖动中就放弃这一次，答放没放弃。 */
  cancel(): boolean;
  /** 直接跳到某处（键盘），交还规则同松手。 */
  seekTo(seconds: number): void;
}

/**
 * 进度线的拖动：按住时显示拖到的位置、宿主的进度一概不理，松手才 seek，之后接着显示拖到的位置，等宿主报回的
 * 位置落到附近才交还（`seekDraft.ts`）。拖动中按下右键也是放弃，随后那次右键菜单吞掉。按下时量一次线的位置与
 * 宽，拖动中不再量：拖着的时候版式不变。
 */
export function useSeekGesture(options: SeekGestureOptions): SeekGesture {
  const { enabled, duration, position, trackKey } = options;
  const [draft, setDraft] = useState<SeekDraft>(SEEK_IDLE);
  const cancelDrag = useRef<(() => void) | null>(null);
  const latest = useRef(options);
  // 右键取消拖动后，吞掉随后那次右键菜单的监听；卸下时摘掉。
  const unswallow = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = options;
  });

  // 宿主报来的位置落到拖到的位置附近就交还；渲染中调整，不多等一帧。
  const settled = settleWith(draft, position);
  if (settled !== draft) setDraft(settled);

  useEffect(() => {
    if (draft.phase !== 'settling') return;
    const timer = setTimeout(() => setDraft(SEEK_IDLE), SEEK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  useLayoutEffect(() => {
    cancelDrag.current?.();
    setDraft(SEEK_IDLE);
  }, [trackKey]);
  useLayoutEffect(() => {
    if (!enabled) cancelDrag.current?.();
  }, [enabled]);
  useLayoutEffect(
    () => () => {
      cancelDrag.current?.();
      unswallow.current?.();
    },
    [],
  );

  const seekTo = (seconds: number) => {
    setDraft({ phase: 'settling', seconds });
    latest.current.seek(seconds);
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
    setDraft({ phase: 'dragging', seconds });
    latest.current.onDragChange?.(true);
    const move = (moved: globalThis.PointerEvent) => {
      // 按着左键再按右键是取消：浏览器不为第二个键另发 pointerdown，只在 pointermove 里报多出来的键。
      if ((moved.buttons & RIGHT_BUTTON) !== 0) {
        unswallow.current?.();
        unswallow.current = swallowNextContextMenu();
        end(false);
        return;
      }
      seconds = at(moved.clientX);
      setDraft({ phase: 'dragging', seconds });
    };
    const end = (commit: boolean) => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', drop);
      element.removeEventListener('lostpointercapture', drop);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      cancelDrag.current = null;
      if (commit) seekTo(seconds);
      else setDraft(SEEK_IDLE);
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
    press,
    cancel() {
      if (!cancelDrag.current) return false;
      cancelDrag.current();
      return true;
    },
    seekTo,
  };
}
