import { cubicBezier, CURVE, DURATION_MS, type Ease } from '../../motion/timing.ts';

export type SeekMotionKind = 'click' | 'key' | 'home' | 'drag' | 'return';

export interface SeekMotionIntent {
  readonly sequence: number;
  readonly kind: SeekMotionKind;
}

export interface SeekMotionInput {
  readonly generation: number;
  readonly fraction: number;
  readonly present: boolean;
  readonly reduced: boolean;
  readonly visible: boolean;
  readonly intent: SeekMotionIntent | null;
}

export interface SeekMotionClock {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

interface Travel {
  readonly from: number;
  readonly start: number;
  readonly duration: number;
  readonly distance: number;
  readonly ease: Ease;
  readonly reset: boolean;
}

export interface SeekMotion {
  update(input: SeekMotionInput): void;
  dispose(): void;
}

const RESET_POINTS = [0, 0, 0.5, 1] as const;
const RESET_EASE = cubicBezier(...RESET_POINTS);
const RESET_TAIL_MS = 500;
// 此曲线单调；交换横纵坐标反求收回一半时的时间比例，让最后一半距离恰好用500ms。
const RESET_HALF_TIME = cubicBezier(
  RESET_POINTS[1],
  RESET_POINTS[0],
  RESET_POINTS[3],
  RESET_POINTS[2],
)(0.5);
const RESET_DURATION_MS = RESET_TAIL_MS / (1 - RESET_HALF_TIME);

const bounded = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * 只维护屏幕上的比例：操作目标立即更新，位置过渡从上一帧接续；归零时固定终点为0，随后接入新曲最新位置。
 * 普通进度事件直接显示，只有明确的操作意图与播放轮次触发缓动。绘制回调不改变业务状态。
 */
export function createSeekMotion(
  clock: SeekMotionClock,
  paint: (fraction: number) => void,
): SeekMotion {
  let input: SeekMotionInput | null = null;
  let shown = 0;
  let travel: Travel | null = null;
  let frame: number | null = null;
  let ticket = 0;

  const draw = (fraction: number) => {
    shown = bounded(fraction);
    paint(shown);
  };
  const stop = () => {
    ticket += 1;
    if (frame !== null) clock.cancel(frame);
    frame = null;
    travel = null;
  };
  const snap = (fraction: number) => {
    stop();
    draw(fraction);
  };

  function schedule(): void {
    const mine = ticket;
    frame = clock.request(() => {
      if (mine !== ticket) return;
      frame = null;
      if (!travel || !input) return;
      const current = travel;
      const progress = Math.min(1, Math.max(0, (clock.now() - current.start) / current.duration));
      const target = current.reset ? 0 : bounded(input.fraction);
      draw(
        progress >= 1 ? target : current.from + (target - current.from) * current.ease(progress),
      );
      if (progress < 1) schedule();
      else if (current.reset && input.fraction !== 0) {
        travel = null;
        begin(false, DURATION_MS.fast, CURVE.pointToPoint.ease);
      } else travel = null;
    });
  }

  function begin(reset: boolean, duration: number, ease: Ease): void {
    const target = reset ? 0 : bounded(input?.fraction ?? 0);
    const distance = Math.abs(target - shown);
    const remaining = !reset && travel ? Math.min(1, distance / travel.distance) : 1;
    stop();
    if (shown === target) {
      draw(target);
      if (reset && input && input.fraction !== 0)
        begin(false, DURATION_MS.fast, CURVE.pointToPoint.ease);
      return;
    }
    travel = {
      from: shown,
      start: clock.now(),
      duration: duration * remaining,
      distance,
      ease,
      reset,
    };
    schedule();
  }

  return {
    update(next) {
      const previous = input;
      input = next;
      if (
        !previous ||
        !previous.present ||
        !next.present ||
        next.reduced ||
        !next.visible ||
        !previous.visible
      ) {
        snap(next.fraction);
        return;
      }
      if (next.generation !== previous.generation) {
        begin(true, RESET_DURATION_MS, RESET_EASE);
        return;
      }
      const intent = next.intent;
      if (intent && intent.sequence !== previous.intent?.sequence) {
        if (intent.kind === 'drag') snap(next.fraction);
        else {
          begin(
            false,
            intent.kind === 'home' ? DURATION_MS.normal : DURATION_MS.fast,
            intent.kind === 'click' ? CURVE.decelerateMid.ease : CURVE.pointToPoint.ease,
          );
        }
        return;
      }
      if (!travel) draw(next.fraction);
    },
    dispose() {
      stop();
      input = null;
    },
  };
}
