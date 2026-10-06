import { CURVE, DURATION_MS, motionDuration } from '../../../motion/timing.ts';
import {
  queueMotionGhost,
  queueMotionItems,
  removeQueueMotionGhost,
  type QueueMotionItem,
} from './queueMotionDom.ts';

type Lane = 'queued' | 'upnext' | 'review' | 'current';
export interface QueueMotionState {
  readonly revision: string;
  readonly current: string | null;
  readonly backward: boolean;
  readonly reduced: boolean;
  readonly pending?: boolean;
  readonly keys?: ReadonlySet<string>;
  readonly ambiguous?: ReadonlySet<string>;
}

/** 每个分区只保留一轮可见快照，数据抵达和滚动挂载分别处理。 */
export function createQueueStateMotion(root: HTMLElement, lane: Lane) {
  const selector =
    lane === 'current' ? '[data-current-part]' : `[data-queue-row][data-kind="${lane}"]`;
  let previous: Map<string, QueueMotionItem> | null = null;
  let revision: string | null = null;
  let lastState: QueueMotionState | null = null;
  const animations = new Set<Animation>();
  const ghosts = new Set<HTMLElement>();
  let blockedUntil = 0;
  const cancel = () => {
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    ghosts.forEach(removeQueueMotionGhost);
    ghosts.clear();
  };
  const animate = (
    node: HTMLElement,
    frames: Keyframe[],
    duration: number,
    delay: number,
    linear = false,
    entering = false,
  ) => {
    const reduced = lastState?.reduced ?? false;
    const animation = node.animate(frames, {
      duration: motionDuration(duration, reduced),
      delay: reduced ? 0 : delay,
      easing: linear
        ? CURVE.linear.timing
        : entering
          ? CURVE.decelerateMid.timing
          : CURVE.pointToPoint.timing,
      fill: 'both',
    });
    animations.add(animation);
    void animation.finished.then(
      () => {
        animations.delete(animation);
        animation.cancel();
        if (ghosts.has(node) && !node.getAnimations().length) {
          ghosts.delete(node);
          removeQueueMotionGhost(node);
        }
      },
      () => {},
    );
  };
  const enter = (
    node: HTMLElement,
    x: number,
    y: number,
    delay: number,
    duration: number = DURATION_MS.fast,
  ) => {
    animate(
      node,
      [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
      duration,
      delay,
      false,
      true,
    );
    animate(node, [{ opacity: 0 }, { opacity: 1 }], DURATION_MS.faster, delay, true);
  };
  const exit = (item: QueueMotionItem, x: number, y: number) => {
    const ghost = queueMotionGhost(root, item);
    ghosts.add(ghost);
    animate(
      ghost,
      [{ transform: 'translate(0, 0)' }, { transform: `translate(${x}px, ${y}px)` }],
      DURATION_MS.faster,
      0,
    );
    animate(ghost, [{ opacity: 1 }, { opacity: 0 }], DURATION_MS.faster, 0, true);
  };
  const interrupt = (event: Event) => {
    const target = event.target;
    if (
      event.type === 'scroll' &&
      target instanceof HTMLElement &&
      target.dataset.queueMotionScroll === String(target.scrollTop)
    )
      return;
    cancel();
    previous = null;
    // 滚动、拖动与开合优先，不在同一轮指针操作中恢复补位。
    blockedUntil = performance.now() + DURATION_MS.slow;
  };
  const scroller = root.closest('[data-queue-page]')?.parentElement;
  scroller?.addEventListener('scroll', interrupt);
  root.addEventListener('scroll', interrupt, true);
  root.addEventListener('wheel', interrupt, { passive: true });
  const pointer = () => {
    cancel();
    previous = queueMotionItems(root, selector);
  };
  root.addEventListener('pointerdown', pointer);

  return {
    update(state: QueueMotionState) {
      const oldState = lastState;
      if (state.reduced !== oldState?.reduced) cancel();
      // 刷新期间原 DOM 和滚动高度仍在，只等可信快照，不另造悬空的等待层。
      if (state.pending) return;
      lastState = state;
      const now = queueMotionItems(root, selector);
      if (revision === state.revision) {
        if (!animations.size) previous = now;
        return;
      }
      // 连续更新从旧动画的可见位置继续；先采位置，再释放动画到最终布局。
      if (previous && animations.size) {
        previous = new Map(
          [...previous].map(([key, item]) => [
            key,
            item.node.isConnected ? { ...item, rect: item.node.getBoundingClientRect() } : item,
          ]),
        );
      }
      cancel();
      const final = queueMotionItems(root, selector);
      const before =
        previous ?? (lane === 'review' && oldState ? new Map<string, QueueMotionItem>() : null);
      revision = state.revision;
      previous = final;
      // 历史区开合、拉开收拢时整个队列滚动区在位移，这期间队列各段不另做补位。
      const folding = root
        .closest('[data-queue-page]')
        ?.parentElement?.getAnimations()
        .some((a) => a.playState === 'running');
      if (folding && lane !== 'review') previous = null;
      if (
        !before ||
        performance.now() < blockedUntil ||
        folding ||
        root.querySelector('[data-lifted]')
      )
        return;
      const changedCurrent = oldState?.current !== state.current;
      const removed = [...before.values()].filter((item) => !final.has(item.key));
      const inserted = [...final.values()].filter((item) => !before.has(item.key));
      const delay = lane === 'queued' && removed.length && !changedCurrent ? DURATION_MS.faster : 0;
      for (const item of before.values()) {
        const next = final.get(item.key);
        if (lane === 'current') {
          if (next && next.identity !== item.identity) {
            if (changedCurrent) {
              exit(item, 0, -12);
              enter(next.node, 0, state.backward ? -12 : 12, 0);
            } else {
              animate(next.node, [{ opacity: 0 }, { opacity: 1 }], DURATION_MS.faster, 0, true);
            }
          }
          continue;
        }
        const ambiguous =
          state.ambiguous?.has(item.handle) || oldState?.ambiguous?.has(item.handle);
        if (!next) {
          // 视口边缘回收不算移除；来源切换只对仍在视口的离开项做短退场。
          if (state.keys?.has(item.key)) continue;
          const played = item.handle === state.current;
          if (lane === 'upnext' && !changedCurrent) continue;
          exit(
            item,
            ambiguous ? 0 : lane === 'queued' && !played ? 16 : 0,
            ambiguous
              ? 0
              : played && lane === 'review'
                ? 12
                : lane === 'queued' && !played
                  ? 0
                  : -12,
          );
        } else if (!ambiguous) {
          const delta = item.rect.top - next.rect.top;
          if (Math.abs(delta) > 1 && Math.abs(delta) < root.clientHeight) {
            const duration =
              lane === 'queued' && !removed.length && !inserted.length
                ? DURATION_MS.normal
                : DURATION_MS.fast;
            animate(
              next.node,
              [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
              duration,
              delay,
            );
          }
        }
      }
      if (lane !== 'current')
        for (const item of inserted) {
          if (oldState?.keys?.has(item.key)) continue;
          if (lane === 'queued')
            enter(
              item.node,
              state.ambiguous?.has(item.handle) ? 0 : 16,
              0,
              DURATION_MS.fast,
              DURATION_MS.faster,
            );
          else if (lane === 'review') enter(item.node, 0, 12, 0);
          else if (changedCurrent) enter(item.node, 0, state.backward ? -12 : 12, 0);
        }
    },
    dispose() {
      cancel();
      previous = null;
      scroller?.removeEventListener('scroll', interrupt);
      root.removeEventListener('scroll', interrupt, true);
      root.removeEventListener('wheel', interrupt);
      root.removeEventListener('pointerdown', pointer);
    },
  };
}
