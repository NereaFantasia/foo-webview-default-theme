import { FOLD_CLOSE, FOLD_OPEN } from './foldMotion.ts';
import type { Ease } from './timing.ts';

/** 元素的上下沿，像素，与 `getBoundingClientRect` 同一坐标系。 */
export interface Edges {
  readonly top: number;
  readonly bottom: number;
}

export interface Shift {
  /** 内容在场时，这个元素比内容不在场时往下多挪的距离。 */
  readonly shift: number;
  /**
   * 内容在场时它被挤矮了多少。整体下移的元素为 0；占满余量、底边贴着下面固定元素的一栏底边不动，
   * 被挤矮的就是挪下去的距离。
   */
  readonly squeeze: number;
}

export function followerShift(present: Edges, absent: Edges): Shift {
  const shift = present.top - absent.top;
  return { shift, squeeze: Math.max(0, shift - (present.bottom - absent.bottom)) };
}

/** 从进度 `from` 走到 `to`（都在 0–1）要多久：全程 `full` 毫秒，按还要走的比例缩短，中途反向时不从头播。 */
export function remainingMs(full: number, from: number, to: number): number {
  return full * Math.min(1, Math.abs(to - from));
}

interface Clock {
  readonly finished: Promise<unknown>;
  readonly currentTime: Animation['currentTime'];
  cancel(): void;
}

/** 开合要用到的元素能力，`HTMLElement` 都有。 */
export interface FoldElement {
  inert: boolean;
  readonly style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Clock;
  getBoundingClientRect(): Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width' | 'height'>;
}

export interface FlowFoldOptions<E extends FoldElement> {
  /** 一开始是否展开；展开时内容已在文档里。 */
  readonly open: boolean;
  /** 开合的内容。收起时一直留在文档里，到 `onClosed` 才由调用方卸掉；展开时调用方先把它放回文档。 */
  readonly body: () => E | null;
  /** 会被内容挤动的元素。内容在文档流里时调用。 */
  readonly followers: (body: E) => readonly E[];
  /** 元素里要一起位移的子元素。 */
  readonly parts: (element: E) => readonly E[];
  /** 收起播完。 */
  readonly onClosed: () => void;
}

export interface FlowFold {
  /** 开合状态或减弱动效设置变了之后、浏览器绘制之前调用，比如 React 的布局 effect 里。 */
  set(open: boolean, reduced: boolean): void;
  /** 停掉正在播的动画，撤掉加在下面元素上的裁剪；之后仍可再调 `set`。 */
  dispose(): void;
}

type Phase = 'shown' | 'closing' | 'hidden' | 'opening';

/** 正在播的一段：进度从 `from` 到 `to`，按 `clock` 的已播时长与曲线算出当前值。 */
interface Leg {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly ease: Ease;
  readonly clock: Clock;
}

interface Follower<E> {
  readonly element: E;
  readonly shift: number;
  /** 被挤矮的一栏：它自己不动、当裁剪框，里面的子元素位移。 */
  readonly framed: boolean;
  /** 要位移的元素：被挤矮的一栏是它的子元素，整体下移的元素就是它自己。 */
  readonly movers: readonly E[];
}

function edgesOf(element: FoldElement): Edges {
  const { top, bottom } = element.getBoundingClientRect();
  return { top, bottom };
}

const DETACHED = ['position', 'width', 'height', 'pointer-events', 'overflow', 'translate'];

function attach(body: FoldElement): void {
  for (const property of [...DETACHED, 'visibility']) body.style.removeProperty(property);
}

/**
 * 文档流里一段内容的开合，照 WinUI Expander：内容从标题下面滑出、滑回去，展开 333 ms、收起 167 ms。
 * Expander 让下面的内容第 0 帧跳到终位；这里改成跟着内容同步让位、补位，两者在同一个进度上，始终贴着。
 *
 * 裁剪都由不动的框做，动的只有位移：内容自己钉在原位当框，里面的子元素往上藏；被挤矮的一栏同样自己不动，
 * 里面的子元素往下让。裁剪与位移若都放在同一个移动的元素上，浏览器可能把两者分在不同线程上算，
 * 负载高时不同步，内容会越过标题露出来。
 *
 * 动画期间内容脱离文档流，布局停在内容不在场的样子：被挤矮的一栏此时最高，往下让位时底部挤出去的部分
 * 被它自己裁掉，不留空白、也不盖住下面固定的内容。播完才换到终值布局，不逐帧改高。
 * 中途反向从当前位置接着走。减弱动效时当场到终态，`onClosed` 照常调一次。
 *
 * 只管这一段内容自己的开合；滚动、分页、数据读回不经这里，不当成增删。
 */
export function createFlowFold<E extends FoldElement>(options: FlowFoldOptions<E>): FlowFold {
  let phase: Phase = options.open ? 'shown' : 'hidden';
  let followers: Follower<E>[] = [];
  let parts: readonly E[] = [];
  let height = 0;
  let running: Clock[] = [];
  let leg: Leg | null = null;
  // 每次 stop 加一；动画播完时代次已变，说明被打断过，不再收尾。
  let generation = 0;

  function stop(): void {
    generation++;
    for (const animation of running) animation.cancel();
    running = [];
    leg = null;
  }

  function release(): void {
    for (const follower of followers) {
      if (follower.framed) follower.element.style.removeProperty('overflow');
    }
  }

  /** 进度：0 是收起，1 是展开。没有在播时按所处阶段取终点。 */
  function progress(): number {
    if (!leg) return phase === 'shown' || phase === 'opening' ? 1 : 0;
    const time = typeof leg.clock.currentTime === 'number' ? leg.clock.currentTime : 0;
    const linear = leg.duration > 0 ? Math.min(1, time / leg.duration) : 1;
    return leg.from + (leg.to - leg.from) * leg.ease(linear);
  }

  /**
   * 量出内容与下面各元素在内容在场、不在场两种布局下的位置，量完内容已脱离文档流、钉回原位。
   * 脱离后不占位置、不接指针，焦点仍能进去（展开时调用方可以先聚焦里面的输入框）；宽高钉在原值，
   * 免得它按内容撑开，给外面的滚动区平白添出滚动范围。
   */
  function measure(body: E): void {
    attach(body);
    release();
    const elements = options.followers(body);
    const present = elements.map(edgesOf);
    const home = body.getBoundingClientRect();
    body.style.setProperty('position', 'absolute');
    body.style.setProperty('width', `${home.width}px`);
    body.style.setProperty('height', `${home.height}px`);
    body.style.setProperty('pointer-events', 'none');
    body.style.setProperty('overflow', 'hidden');
    const away = body.getBoundingClientRect();
    body.style.setProperty('translate', `${home.left - away.left}px ${home.top - away.top}px`);
    height = home.height;
    parts = options.parts(body);
    followers = [];
    elements.forEach((element, index) => {
      const before = present[index];
      if (!before) return;
      const { shift, squeeze } = followerShift(before, edgesOf(element));
      if (Math.abs(shift) < 0.5) return;
      const framed = squeeze > 0;
      if (framed) element.style.setProperty('overflow', 'hidden');
      followers.push({
        element,
        shift,
        framed,
        movers: framed ? options.parts(element) : [element],
      });
    });
  }

  function go(body: E, from: number, to: 0 | 1): void {
    stop();
    phase = to === 1 ? 'opening' : 'closing';
    body.inert = to === 0;
    const spec = to === 1 ? FOLD_OPEN : FOLD_CLOSE;
    const duration = remainingMs(spec.duration, from, to);
    // 停在终点，等换了布局或卸掉再撤，不然播完到那一步之间会闪回原位一帧。
    const timing = { duration, easing: spec.curve.timing, fill: 'forwards' } as const;
    const move = (element: E, start: number, end: number) =>
      element.animate([{ translate: `0 ${start}px` }, { translate: `0 ${end}px` }], timing);
    // 内容露出的总是下部：没露出的部分往上藏到框外。
    const hidden = (at: number) => -height * (1 - at);
    running = [
      ...parts.map((part) => move(part, hidden(from), hidden(to))),
      ...followers.flatMap((follower) =>
        follower.movers.map((mover) => move(mover, from * follower.shift, to * follower.shift)),
      ),
    ];
    const [clock] = running;
    if (!clock) {
      finish(body, to);
      return;
    }
    leg = { from, to, duration, ease: spec.curve.ease, clock };
    const mine = generation;
    void Promise.all(running.map((animation) => animation.finished)).then(
      () => {
        if (mine === generation) finish(body, to);
      },
      () => {},
    );
  }

  function finish(body: E, to: 0 | 1): void {
    if (to === 1) {
      // 先放回文档流，再撤掉位移：两者在同一帧里抵消，画面不动。
      attach(body);
      release();
      stop();
      phase = 'shown';
      return;
    }
    // 调用方卸掉内容之前还可能画一帧；撤了位移里面的子元素会回到框里，所以先藏起来。
    body.style.setProperty('visibility', 'hidden');
    release();
    stop();
    phase = 'hidden';
    options.onClosed();
  }

  function jump(body: E | null, open: boolean): void {
    stop();
    release();
    if (open) {
      if (body) {
        attach(body);
        body.inert = false;
      }
      phase = 'shown';
      return;
    }
    if (phase === 'hidden') return;
    phase = 'hidden';
    options.onClosed();
  }

  return {
    set(open, reduced) {
      const body = options.body();
      if (!body || reduced) {
        jump(body, open);
        return;
      }
      if (open) {
        if (phase === 'hidden') {
          stop();
          measure(body);
          go(body, 0, 1);
        } else if (phase === 'closing') go(body, progress(), 1);
        return;
      }
      if (phase === 'shown') {
        stop();
        measure(body);
        go(body, 1, 0);
      } else if (phase === 'opening') go(body, progress(), 0);
    },
    dispose() {
      stop();
      release();
    },
  };
}

function scrolls(element: Element): boolean {
  const { overflowY } = getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll';
}

/**
 * 内容在文档流里挤得动的元素：从内容往外，每一层排在它后面的兄弟。到滚动容器为止，滚动区自身的尺寸
 * 不随里面的内容变，它外面的元素不会被挤动。没被挤动的元素量完就筛掉。
 */
export function followersOf(body: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  let node: HTMLElement = body;
  for (;;) {
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
      if (next instanceof HTMLElement) result.push(next);
    }
    const parent = node.parentElement;
    if (!parent || parent === document.body || scrolls(parent)) return result;
    node = parent;
  }
}

export function partsOf(element: HTMLElement): HTMLElement[] {
  return [...element.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
}
