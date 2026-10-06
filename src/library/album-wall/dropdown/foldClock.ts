import { tweenAt, tweenDone, type Tween } from '../../../motion/foldMotion.ts';

/** 补间的起点等渲染层提交了新结构再定：先填它，提交那一刻换成当时的时刻。 */
export const ARMED = Number.POSITIVE_INFINITY;

/** 一条下拉在时钟眼里的样子。 */
export interface ClockSlot {
  readonly id: number;
  /** 面板高，也就是条目流里给它留的高（不含行间距）。 */
  readonly panel: number;
  /** 静止时露出的高；有补间时按补间。 */
  rest: number;
  tween: Tween | null;
  readonly closing: boolean;
}

/** 一帧要画的：每条下拉露出多高；条目流里排在前 n 条下拉之后的元素往上挪多少（`shifts[n - 1]`，≤ 0）。 */
export interface FoldFrame {
  readonly visible: ReadonlyMap<number, number>;
  readonly shifts: readonly number[];
}

export interface FoldClockHost {
  /** 此刻的滚动位置；逐帧读，看用户有没有自己滚过。 */
  scrollTop(): number;
  scrollTo(top: number): void;
  paint(frame: FoldFrame): void;
  now(): number;
  /** 下一帧调 `callback`，答撤销的函数。 */
  frame(callback: () => void): () => void;
}

/** 时钟向下拉的主人要的：结构、提交那一刻的顺序与滚动，以及收完、停下的通知。 */
export interface FoldClockModel {
  slots(): readonly ClockSlot[];
  /** 提交那一刻：真正插进条目流的下拉，从上到下。 */
  order(): number[];
  /** 提交那一刻的行间距：条目流里给一条下拉留的是面板高加它。 */
  gap(): number;
  /** 提交那一刻：视口要跟着哪段补间从哪滚到哪；不滚答 null。 */
  scroll(now: number): { readonly lead: Tween; readonly from: number; readonly to: number } | null;
  /** 这几条收完了：移出结构，叫渲染层重画。 */
  finished(slots: readonly ClockSlot[]): void;
  /** 全部停下：虚拟滚动不必再多画几行。 */
  idle(): void;
}

export function visibleAt(slot: ClockSlot, now: number): number {
  return slot.tween ? tweenAt(slot.tween, now) : slot.rest;
}

/**
 * 下拉动画的时钟：逐帧按补间算每条下拉露出多高、下面的元素挪多少，画出去；视口跟着领头的补间滚，
 * 用户自己滚过（位置不是上一帧设的）就不再滚。结构一变（`invalidate`）就停画，等渲染层提交了
 * （`committed`）才让新补间起步、按新结构接着画，画面与 DOM 因此不会错开一帧。
 */
export class FoldClock {
  private stale = false;
  private order: number[] = [];
  private gap = 0;
  private scroll: Tween | null = null;
  private lastScroll: number | undefined;
  private cancel: (() => void) | null = null;
  private animating = false;
  private readonly host: FoldClockHost;
  private readonly model: FoldClockModel;

  constructor(host: FoldClockHost, model: FoldClockModel) {
    this.host = host;
    this.model = model;
  }

  /** 结构变了，渲染层还没提交。 */
  invalidate(): void {
    this.stale = true;
  }

  /** 用户自己滚了：自动滚动就此停下。 */
  stopScroll(): void {
    this.scroll = null;
  }

  /** 渲染层提交之后调（布局阶段）：挂着的补间从这一刻起步，按新结构画一帧。 */
  committed(): void {
    const now = this.host.now();
    const stale = this.stale;
    if (stale) {
      this.stale = false;
      for (const slot of this.model.slots()) {
        if (slot.tween?.start === ARMED) slot.tween = { ...slot.tween, start: now };
      }
      this.order = this.model.order();
      this.gap = this.model.gap();
      const plan = this.model.scroll(now);
      if (plan) {
        this.scroll = { ...plan.lead, from: plan.from, to: plan.to };
        this.lastScroll = undefined;
      }
    }
    if (stale || this.model.slots().length > 0) this.paint(now);
    this.schedule();
  }

  /**
   * 停下逐帧推进，状态留着：卸掉时调。开发时 StrictMode 卸掉又马上挂回，挂回后下一次提交接着走。
   */
  pause(): void {
    this.cancel?.();
    this.cancel = null;
  }

  /**
   * 一条下拉在条目流里占面板高加一个行间距。下面的元素往上挪的是还没露出的那一截：面板没露出的高，加上
   * 行间距里还没露出的部分。行间距跟着面板最先露出、最后收走的那一截走（露出的高不到一个行间距时按露出的
   * 高算），所以收到 0 时下面的元素正好落在移出条目流之后的位置，展开的第 0 帧也正好在展开之前的位置，
   * 两头都不跳。
   */
  private paint(now: number): void {
    const visible = new Map<number, number>();
    const shifts: number[] = [];
    let deficit = 0;
    for (const id of this.order) {
      const slot = this.model.slots().find((candidate) => candidate.id === id);
      if (!slot) continue;
      const shown = visibleAt(slot, now);
      visible.set(id, shown);
      deficit += slot.panel + this.gap - shown - Math.min(this.gap, shown);
      shifts.push(0 - deficit);
    }
    this.host.paint({ visible, shifts });
    if (!this.scroll) return;
    if (this.lastScroll !== undefined && Math.abs(this.host.scrollTop() - this.lastScroll) > 1) {
      this.scroll = null;
      return;
    }
    this.lastScroll = tweenAt(this.scroll, now);
    this.host.scrollTo(this.lastScroll);
  }

  private schedule(): void {
    if (this.cancel) return;
    if (!this.model.slots().some((slot) => slot.tween) && !this.scroll) return;
    this.animating = true;
    this.cancel = this.host.frame(() => this.tick());
  }

  private tick(): void {
    this.cancel = null;
    const now = this.host.now();
    if (!this.stale) this.paint(now);
    const finished: ClockSlot[] = [];
    for (const slot of this.model.slots()) {
      if (!slot.tween || slot.tween.start === ARMED || !tweenDone(slot.tween, now)) continue;
      slot.rest = slot.tween.to;
      slot.tween = null;
      if (slot.closing) finished.push(slot);
    }
    if (this.scroll && tweenDone(this.scroll, now)) this.scroll = null;
    if (finished.length > 0) this.model.finished(finished);
    const idle = !this.model.slots().some((slot) => slot.tween) && !this.scroll;
    if (idle && this.animating) {
      this.animating = false;
      this.model.idle();
    }
    if (!idle) this.schedule();
  }
}
