import { reanchor } from './anchor.ts';
import {
  EXIT_MS,
  REDUCED_FADE_MS,
  enteringPose,
  entryEnd,
  entryProgress,
  entryRank,
  entryTilt,
  exitFactor,
  fadeInFactor,
  offscreenOffset,
} from './entrance.ts';
import { CARRY, glideAt, glideDone, glideVelocity, startGlide, type Glide } from './glide.ts';
import { DIM_SHADE, RENDER_RADIUS, slotAt } from './slots.ts';

/**
 * Coverflow 逐帧动效引擎
 *
 * 核心驱动浏览位置 pos 补间插值，按帧将几何变换（transform）与透明度（opacity）直接写入卡片元素样式，
 * 避免经过 React 重渲染周期；入场阶段两侧卡片依序从屏外滑入，退出阶段执行淡出过渡；
 * 动效降级或视口不可见时直接同步至终态；解耦 DOM 与浏览器依赖，由外部注入元素节点与时钟源
 */

/** 引擎托管卡片元素样式接口契约 */
export interface CardElement {
  readonly style: {
    transform: string;
    opacity: string;
    visibility: string;
    zIndex: string;
    setProperty(name: string, value: string): void;
  };
  readonly dataset: Record<string, string | undefined>;
}

export interface EngineCard {
  readonly key: string;
  /** 条目在全局序列中的索引下标 */
  readonly index: number;
  readonly element: CardElement;
  /** 当前播放曲目标记（退出时即刻隐藏，共享过渡命名已交接） */
  readonly current: boolean;
}

export interface StageGeometry {
  /** 舞台总宽度（像素），用于屏外位移计算 */
  readonly width: number;
  /** 焦点封面边长（像素） */
  readonly cover: number;
  /** 侧封面水平间距的收紧系数，乘在槽位表的偏移上 */
  readonly spread: number;
  readonly perspective: number;
}

export interface EngineClock {
  /** 毫秒，单调 */
  now(): number;
  /** 下一帧叫一次 `callback`，答取消函数 */
  frame(callback: () => void): () => void;
}

export interface CoverflowEngine {
  /** 每次渲染提交后给全部要画的卡；下标会随条目表重排变，所以整张表替换 */
  setCards(cards: readonly EngineCard[]): void;
  setGeometry(geometry: StageGeometry): void;
  /** 窗口看不见时为假：进行中的动效直接到终态，之后的变化也不播 */
  setVisible(visible: boolean): void;
  /** 减弱动效：位置直接跳，进入时只淡入，不飞 */
  setReduced(reduced: boolean): void;
  /** 此刻的浏览位置（第几条，小数） */
  position(): number;
  /** 位置直接放到 `target`，不补间（挂上时用） */
  jumpTo(target: number): void;
  /** 补间到 `target`；补间途中再调，从当时的位置和速度接着走，速度不跳 */
  goTo(target: number): void;
  /** 条目表重排：先按键把位置接到新表上（卡留在原地），再补间到 `target` */
  rekey(previous: readonly string[], next: readonly string[], target: number): void;
  /** 进入：选中项 `center` 不飞，其余登记着的卡从左到右依次飞入；减弱动效时在槽位上淡入 */
  enter(center: number): void;
  /** 退出：整排淡出，正在播放那张当帧藏起 */
  leave(): void;
  /** 立刻按此刻的状态写一遍 */
  paint(): void;
  dispose(): void;
}

export interface EngineOptions {
  /** 位置补间走完时叫，用来把渲染的范围收回到选中项两侧 */
  readonly onSettle?: () => void;
}

interface Intro {
  readonly start: number;
  readonly fade: boolean;
  readonly duration: number;
  readonly ranks: ReadonlyMap<string, number>;
}

/** 点亮系数朝目标走的时间常数，毫秒：约 70 ms 走过 63%、210 ms 走过 95%。比相邻两次按键的间隔长，快速滚动时来不及亮 */
const LIT_TAU_MS = 70;
const LIT_EPSILON = 0.005;

export function createCoverflowEngine(
  clock: EngineClock,
  options: EngineOptions = {},
): CoverflowEngine {
  let cards: readonly EngineCard[] = [];
  let geometry: StageGeometry = { width: 0, cover: 0, spread: 1, perspective: 0 };
  let visible = true;
  let reduced = false;
  let rest = 0;
  let glide: Glide | null = null;
  let intro: Intro | null = null;
  let outro: { readonly start: number } | null = null;
  let cancel: (() => void) | null = null;
  // 每张卡的点亮系数，0 到 1：只有浏览的落点那一张（序号等于 `rest`）朝 1 走，别的朝 0 走。
  // 没有点亮的封面经过中间位置也保持压暗，滚动时一张张掠过不会一闪一闪地变亮，只有确定的落点才亮起来
  const lit = new Map<string, number>();
  let lastPaint = Number.NEGATIVE_INFINITY;

  // 退场开始后位置定在原地：淡出就是原地淡出，不跟着选中项（关模式时选中会回到正在播放那一首）再滚
  let frozenAt: number | null = null;
  const positionAt = (now: number) => frozenAt ?? (glide ? glideAt(glide, now) : rest);
  const velocityAt = (now: number) => (glide ? glideVelocity(glide, now) : 0);
  const litGoal = (card: EngineCard) => (card.index === rest ? 1 : 0);

  function animating(now: number): boolean {
    return (
      (glide !== null && !glideDone(glide, now)) ||
      (intro !== null && now - intro.start < intro.duration) ||
      (outro !== null && now - outro.start < EXIT_MS) ||
      (frozenAt === null &&
        cards.some((card) => (lit.get(card.key) ?? litGoal(card)) !== litGoal(card)))
    );
  }

  function write(card: EngineCard, d: number, now: number, brightness: number): void {
    const slot = slotAt(d);
    // 间距在入场插值之前收紧，飞入的终点才是收紧后的槽位
    let pose = { ...slot, offset: slot.offset * geometry.spread };
    let factor = 1;
    const rank = intro?.ranks.get(card.key);
    if (intro && rank !== undefined) {
      const elapsed = now - intro.start;
      if (intro.fade) factor = fadeInFactor(elapsed);
      else {
        const from = offscreenOffset(geometry.width, geometry.cover, pose.size);
        pose = enteringPose(pose, entryProgress(rank, elapsed), from, entryTilt(rank, elapsed));
      }
    }
    if (outro) factor *= card.current ? 0 : exitFactor(now - outro.start);
    const opacity = pose.opacity * factor;
    const { style } = card.element;
    const flat = Math.abs(pose.tilt) < 1e-3;
    // 不倾斜时不写透视：视图过渡认的是二维变换，进出模式时正在播放那张封面是平的
    style.transform =
      `translateX(${pose.offset * geometry.cover}px) ` +
      (flat ? '' : `perspective(${geometry.perspective}px) rotateY(${pose.tilt}deg) `) +
      `scale(${pose.size})`;
    style.opacity = String(opacity);
    style.visibility = opacity > 0.001 ? 'visible' : 'hidden';
    style.zIndex = String(Math.round((RENDER_RADIUS - Math.min(Math.abs(d), RENDER_RADIUS)) * 10));
    // 没点亮的至少压到 DIM_SHADE，点亮的照槽位的暗层（正中是 0）；两者之间随点亮系数过渡
    const dim = Math.max(pose.shade, DIM_SHADE);
    style.setProperty('--shade', String(dim + (pose.shade - dim) * brightness));
    style.setProperty('--center', String(Math.max(0, 1 - Math.abs(d))));
    card.element.dataset.side = d < 0 ? 'left' : 'right';
  }

  function paintAt(now: number): void {
    const pos = positionAt(now);
    const dt = Number.isFinite(lastPaint) ? Math.min(100, Math.max(0, now - lastPaint)) : 0;
    lastPaint = now;
    // 减弱动效与窗口看不见时不过渡，直接到位；退场期间遮罩定住不变
    const rate = frozenAt !== null ? 0 : reduced || !visible ? 1 : 1 - Math.exp(-dt / LIT_TAU_MS);
    for (const card of cards) {
      const goal = litGoal(card);
      const before = lit.get(card.key);
      // 新挂上的卡直接在目标上，免得进入时整排先暗后亮；离目标不到千分之五就落在目标上，停帧时遮罩是干净的
      const stepped = before === undefined ? goal : before + (goal - before) * rate;
      const next = Math.abs(goal - stepped) < LIT_EPSILON ? goal : stepped;
      lit.set(card.key, next);
      write(card, card.index - pos, now, next);
    }
  }

  function settle(now: number): void {
    if (glide && glideDone(glide, now)) {
      glide = null;
      options.onSettle?.();
    }
    if (intro && now - intro.start >= intro.duration) intro = null;
  }

  function schedule(): void {
    if (cancel) return;
    cancel = clock.frame(() => {
      cancel = null;
      const now = clock.now();
      paintAt(now);
      if (animating(now)) schedule();
      else settle(now);
    });
  }

  /**
   * `velocity` 是此刻带着的速度：条目表重排时是同一段运动的延续，先记下来整个传过来；缺省是用户又操作了一下，
   * 只保留补间途中当前速度的一部分（`CARRY`），免得松手后惯性太大
   */
  function goTo(target: number, velocity?: number): void {
    if (frozenAt !== null) return;
    const now = clock.now();
    if (!visible || reduced) {
      glide = null;
      rest = target;
      options.onSettle?.();
      return;
    }
    const from = positionAt(now);
    const carried = velocity ?? velocityAt(now) * CARRY;
    rest = target;
    if (from === target) {
      glide = null;
      options.onSettle?.();
      return;
    }
    glide = startGlide(from, target, now, carried);
    schedule();
  }

  return {
    goTo: (target) => goTo(target),
    jumpTo(target) {
      glide = null;
      rest = target;
    },
    setCards(next) {
      cards = next;
      const keys = new Set(next.map((card) => card.key));
      for (const key of lit.keys()) if (!keys.has(key)) lit.delete(key);
    },
    setGeometry(next) {
      geometry = next;
    },
    setVisible(next) {
      visible = next;
      if (visible) return;
      // 看不见时没有人在看动效：位置、入场、退场都落到终态
      glide = null;
      intro = null;
      if (outro) outro = { start: Number.NEGATIVE_INFINITY };
      cancel?.();
      cancel = null;
    },
    setReduced(next) {
      reduced = next;
    },
    position: () => positionAt(clock.now()),
    rekey(previous, next, target) {
      if (frozenAt !== null) return;
      const now = clock.now();
      const velocity = velocityAt(now);
      rest = reanchor(previous, positionAt(now), next, target);
      glide = null;
      goTo(target, velocity);
    },
    enter(center) {
      if (!visible) return;
      const first = Math.min(...cards.map((card) => card.index));
      const ranks = new Map<string, number>();
      for (const card of cards) {
        if (card.index !== center) ranks.set(card.key, entryRank(card.index, first, center));
      }
      const now = clock.now();
      intro = {
        start: now,
        fade: reduced,
        duration: reduced ? REDUCED_FADE_MS : entryEnd(ranks.size),
        ranks,
      };
      schedule();
    },
    leave() {
      // 补间还在走也停在此刻的位置
      frozenAt = positionAt(clock.now());
      glide = null;
      outro = { start: visible ? clock.now() : Number.NEGATIVE_INFINITY };
      if (visible) schedule();
    },
    paint() {
      const now = clock.now();
      paintAt(now);
      // 动效还没放完而帧被取消过（卸载后重新挂上）时接着放
      if (animating(now)) schedule();
    },
    dispose() {
      cancel?.();
      cancel = null;
    },
  };
}
