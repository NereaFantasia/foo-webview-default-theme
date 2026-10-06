import { foldTween, resizeTween, type Tween } from '../../../motion/foldMotion.ts';
import {
  dropdownPanelHeight,
  dropdownSpan,
  flowWith,
  foldScrollTarget,
  rowHolding,
  type DropdownPlacement,
  type FoldGeometry,
} from '../albumDropdown.ts';
import { albumKeyOf, type Album } from '../../../host/libraryContract.ts';
import { ARMED, FoldClock, visibleAt, type ClockSlot, type FoldClockHost } from './foldClock.ts';

export interface WallFoldHost extends FoldClockHost {
  geometry(): FoldGeometry;
  /** 下拉的结构变了（开、收完移出、换专辑、改高、动画停了）：渲染层该重画，提交后调 `committed`。 */
  changed(): void;
  /** 取这张的曲目，答首数；失败答 null。 */
  load(album: Album): Promise<number | null>;
  /** 这张此刻知道的首数：曲目表里有就按取到的，没有按专辑行记的。 */
  countOf(album: Album): number;
  reduced(): boolean;
}

/** 渲染层画一条下拉要的。 */
export interface FoldSlotView {
  readonly id: number;
  readonly album: Album;
  readonly sectionKey: string | null;
  readonly panel: number;
  readonly closing: boolean;
  /** 还在开合或改高：曲目没到时，动完了才画骨架行。 */
  readonly moving: boolean;
  /** 同一行点了另一张、正等它的曲目：旧内容先留着，等久了压暗。 */
  readonly waiting: Album | null;
}

export interface FoldSnapshot {
  readonly placements: readonly DropdownPlacement[];
  readonly views: readonly FoldSlotView[];
  /** 动画中的下拉面板高之和：虚拟滚动据此多画几行，平移中的元素才不露白。 */
  readonly reach: number;
}

interface Slot extends ClockSlot {
  album: Album;
  sectionKey: string | null;
  panel: number;
  closing: boolean;
  waiting: { readonly album: Album; readonly sectionKey: string | null } | null;
}

/**
 * 封面墙下拉的开合：一次只开一条，照 Win11 折叠卡——条目流里的高在第 0 帧就到终值，面板用裁剪露出，
 * 下面的元素从旧位置平移到新位置；视口要滚时与展开共用时长和曲线（逐帧推进见 `FoldClock`）。
 *
 * 单击同一张收起；同一行的另一张等曲目到了原地换内容，连点只认最后一次；别的行的一张是旧的收起、
 * 新的展开同时走，滚动目标按两者都结束后的条目流算。旧的那条整个在视口上面时当场撤掉、视口同步
 * 上移，被点的那一行不跟着跑。收起时不把展开时自动滚过的距离滚回去，只在内容变短、视口被迫上移时
 * 跟着收起的时间线走。
 */
export class WallFold {
  private slots: Slot[] = [];
  private sequence = 0;
  /** 提交时要滚的：展开或改高的那条露出来，或收起后内容变短。 */
  private plan: { readonly reveal: Slot | null } | null = null;
  /** 旧的那条当场撤掉后，提交时把视口挪到哪。 */
  private jump: number | null = null;
  private cached: FoldSnapshot | null = null;
  private readonly host: WallFoldHost;
  private readonly clock: FoldClock;

  constructor(host: WallFoldHost) {
    this.host = host;
    this.clock = new FoldClock(host, {
      slots: () => this.slots,
      order: () => this.flowOrder(),
      gap: () => this.host.geometry().gap,
      scroll: () => this.scrollPlan(),
      finished: (done) => {
        this.slots = this.slots.filter((slot) => !done.includes(slot));
        this.change();
      },
      idle: () => this.change(),
    });
  }

  /** 插进条目流的下拉，开着的那条排在最前：同一行只挂一条时它优先。 */
  placements(): DropdownPlacement[] {
    return [...this.slots]
      .sort((a, b) => Number(a.closing) - Number(b.closing) || b.id - a.id)
      .map(({ id, album, sectionKey, panel }) => ({ id, album, sectionKey, panel }));
  }

  /**
   * 渲染层要的一份：插进条目流的下拉、各条的样子与动画中的面板高之和。结构不变就是同一个对象，
   * 条目流据此记忆，不必每次渲染都重排。
   */
  snapshot(): FoldSnapshot {
    this.cached ??= {
      placements: this.placements(),
      views: this.slots.map(({ id, album, sectionKey, panel, closing, tween, waiting }) => {
        const moving = tween !== null;
        return { id, album, sectionKey, panel, closing, moving, waiting: waiting?.album ?? null };
      }),
      reach: this.slots.reduce((sum, slot) => sum + (slot.tween ? slot.panel : 0), 0),
    };
    return this.cached;
  }

  /** 开着（没在收）的那条展示的专辑与所在的节；快照记它。 */
  current(): { readonly album: Album; readonly sectionKey: string | null } | null {
    const live = this.live();
    return live ? { album: live.album, sectionKey: live.sectionKey } : null;
  }

  /** 此刻露出的高；渲染层新画一条下拉时用它起头。 */
  visibleOf(id: number): number {
    const slot = this.slots.find((candidate) => candidate.id === id);
    return slot ? visibleAt(slot, this.host.now()) : 0;
  }

  /** 单击封面或空格：同一张收起，同一行的另一张换内容，别的行换一条。 */
  toggle(album: Album, sectionKey: string | null): void {
    const live = this.live();
    if (live) {
      const shown = live.waiting?.album ?? live.album;
      if (albumKeyOf(shown) === albumKeyOf(album)) return this.collapse(live);
      if (this.sameRow(live, album, sectionKey)) return this.swap(live, album, sectionKey);
      this.leave(live);
    }
    const parked = this.slots.find((slot) => this.sameRow(slot, album, sectionKey));
    if (parked) return this.expand(parked, album, sectionKey);
    const slot = this.slot(album, sectionKey, 0);
    this.slots.push(slot);
    this.expand(slot, album, sectionKey);
  }

  /** ✕ 与 Esc：收起开着的那条。 */
  close(): void {
    const live = this.live();
    if (live) this.collapse(live);
  }

  /** 当场撤掉全部下拉，不播动画：这张被过滤或折叠掉、换了排序或分节依据。 */
  dismiss(): void {
    if (this.slots.length === 0) return;
    this.slots = [];
    this.plan = null;
    this.clock.stopScroll();
    this.change();
  }

  /** 直接开到位，不播动画、不自动滚：回到历史记录、切形态回来。 */
  restore(album: Album, sectionKey: string | null): void {
    const slot = this.slot(album, sectionKey, this.panelOf(album));
    this.slots = [slot];
    this.plan = null;
    this.clock.stopScroll();
    this.change();
    this.fetch(slot, false);
  }

  /** 用户自己滚了（转滚轮、按下指针、按键）：自动滚动就此停下。 */
  userScrolled(): void {
    this.clock.stopScroll();
  }

  /** 渲染层提交之后调（布局阶段）。 */
  committed(): void {
    if (this.jump !== null) this.host.scrollTo(Math.max(0, this.jump));
    this.jump = null;
    this.clock.committed();
  }

  /** 卸掉时调：停下逐帧推进，状态留着，StrictMode 卸掉又挂回时接着用。 */
  pause(): void {
    this.clock.pause();
  }

  private slot(album: Album, sectionKey: string | null, rest: number): Slot {
    const panel = this.panelOf(album);
    const id = ++this.sequence;
    return { id, album, sectionKey, panel, rest, tween: null, closing: false, waiting: null };
  }

  private show(slot: Slot, album: Album, sectionKey: string | null): void {
    slot.album = album;
    slot.sectionKey = sectionKey;
    slot.waiting = null;
  }

  private panelOf(album: Album): number {
    return dropdownPanelHeight(this.host.countOf(album));
  }

  private live(): Slot | undefined {
    return this.slots.find((slot) => !slot.closing);
  }

  private sameRow(slot: Slot, album: Album, sectionKey: string | null): boolean {
    const { items } = this.host.geometry();
    const here = rowHolding(items, albumKeyOf(slot.album), slot.sectionKey);
    const there = rowHolding(items, albumKeyOf(album), sectionKey);
    return here !== undefined && here.index === there?.index;
  }

  private tweenTo(slot: Slot, target: number, resize = false): Tween {
    const current = visibleAt(slot, this.host.now());
    const reduced = this.host.reduced();
    if (resize) return resizeTween(current, target, ARMED, reduced);
    return foldTween(current, target, target || slot.panel, ARMED, reduced);
  }

  /** 展开这一条（新建的，或收着又被点回来的），换成 `album`。 */
  private expand(slot: Slot, album: Album, sectionKey: string | null): void {
    this.show(slot, album, sectionKey);
    slot.closing = false;
    slot.panel = this.panelOf(album);
    slot.tween = this.tweenTo(slot, slot.panel);
    this.plan = { reveal: slot };
    this.change();
    this.fetch(slot, true);
  }

  /** 换到别的行时旧的那条：整个在视口上面就当场撤掉、视口同步上移，否则与新的一条同时收起。 */
  private leave(slot: Slot): void {
    const geometry = this.host.geometry();
    const { flow, tops } = flowWith(geometry.items, this.placements(), geometry);
    const span = dropdownSpan(flow, tops, slot.id);
    if (span && span.next <= geometry.scrollTop) {
      this.slots = this.slots.filter((candidate) => candidate !== slot);
      this.jump = geometry.scrollTop - (span.next - span.top);
      return;
    }
    this.fold(slot);
  }

  private fold(slot: Slot): void {
    slot.tween = this.tweenTo(slot, 0);
    slot.closing = true;
    slot.waiting = null;
  }

  private collapse(slot: Slot): void {
    this.fold(slot);
    this.plan = { reveal: null };
    this.change();
  }

  /** 同一行换一张：等它的曲目到了才换，连点只认最后一次。 */
  private swap(slot: Slot, album: Album, sectionKey: string | null): void {
    const waiting = { album, sectionKey };
    slot.waiting = waiting;
    this.change();
    void this.host.load(album).then((count) => {
      if (slot.waiting !== waiting || !this.slots.includes(slot)) return;
      this.show(slot, album, sectionKey);
      const panel = count === null ? this.panelOf(album) : dropdownPanelHeight(count);
      // 高不变就只换内容：不起补间，也不为露出它去滚视口。
      if (panel !== slot.panel) this.resize(slot, panel, true);
      else this.change();
    });
  }

  /** 取曲目；首数与专辑行记的不同就改高。`reveal` 为假时改高也不滚（直接到位的那一条）。 */
  private fetch(slot: Slot, reveal: boolean): void {
    const album = slot.album;
    void this.host.load(album).then((count) => {
      if (count === null || slot.album !== album || slot.closing) return;
      const panel = dropdownPanelHeight(count);
      if (this.slots.includes(slot) && panel !== slot.panel) this.resize(slot, panel, reveal);
    });
  }

  /** 改高：还在展开就改道接着展开，展开着就按点到点曲线走到新高。 */
  private resize(slot: Slot, panel: number, reveal: boolean): void {
    const opening = slot.tween !== null && slot.tween.to === slot.panel;
    slot.panel = panel;
    slot.rest = panel;
    slot.tween = this.tweenTo(slot, panel, !opening);
    if (reveal) this.plan = { reveal: slot };
    this.change();
  }

  private change(): void {
    this.cached = null;
    this.clock.invalidate();
    this.host.changed();
  }

  /** 条目流里真正插进去的下拉，从上到下；没插进去的收着的那条就此撤掉。 */
  private flowOrder(): number[] {
    const { items, gap } = this.host.geometry();
    const order = flowWith(items, this.placements(), {
      rowHeight: 0,
      headerHeight: 0,
      gap,
    }).flow.flatMap((item) => (item.kind === 'dropdown' ? [item.id] : []));
    const lost = this.slots.filter((slot) => slot.closing && !order.includes(slot.id));
    if (lost.length === 0) return order;
    this.slots = this.slots.filter((slot) => !lost.includes(slot));
    this.change();
    return order;
  }

  /** 按动画结束后的条目流定滚动：展开的放不下才滚；收起的只在内容变短、视口被迫上移时跟着走。 */
  private scrollPlan(): { lead: Tween; from: number; to: number } | null {
    const plan = this.plan;
    this.plan = null;
    if (!plan) return null;
    const geometry = this.host.geometry();
    const live = this.placements().filter((placement) => placement.id === this.live()?.id);
    const reveal = plan.reveal;
    const to = foldScrollTarget(geometry, live, reveal && { id: reveal.id, panel: reveal.panel });
    const lead = reveal
      ? reveal.tween
      : [...this.slots].reverse().find((slot) => slot.closing)?.tween;
    if (to === undefined || !lead || Math.abs(to - geometry.scrollTop) < 1) return null;
    return { lead, from: geometry.scrollTop, to };
  }
}
