import { CURVE, DURATION_MS } from '../../motion/timing.ts';

// 封面网格换列重排动画调度器
//
// 基于 Web Animations API 的 FLIP 机制实现；使用 `composite: 'add'` 叠加逆向位移并过渡归零，
// 元素终点坐标在首帧立即就绪，连续换列时自动累加位移而无需同步回读动画状态

/** 跟随换列位移动画的 DOM 属性，取值为位置键 */
export const REFLOW_KEY_ATTR = 'data-reflow-key';
/** 跟随指定图块移动的从属元素属性（如悬停按钮），取值为所跟随图块的位置键 */
export const REFLOW_FOLLOW_ATTR = 'data-reflow-follow';

/** 视口内已有元素平滑位移至新位置：点到点曲线，耗时 250ms */
export const REFLOW_MOVE = { duration: DURATION_MS.normal, curve: CURVE.pointToPoint } as const;
/** 换列后初次进入视口或跨度超过一屏的元素原地淡入：快速减速，耗时 167ms */
export const REFLOW_ENTER = { duration: DURATION_MS.fast, curve: CURVE.decelerateMid } as const;

export const tileReflowKey = (tileKey: string) => `t:${tileKey}`;

/** 图块层坐标系中的左上角位置，单位 CSS 像素 */
export interface ReflowPlace {
  readonly x: number;
  readonly y: number;
}

/** 移除叠加在元素上的换列动画；跟随元素更换目标图块时清除残留位移 */
export function dropReflow(element: Element): void {
  for (const animation of element.getAnimations()) {
    if (animation.effect instanceof KeyframeEffect && animation.effect.composite === 'add') {
      animation.cancel();
    }
  }
}

/** 参与换列重排动画的 DOM 元素抽象 */
export interface ReflowElement {
  readonly dataset: DOMStringMap;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): unknown;
}

export interface ReflowCommit {
  /** 当前列数；0 表示尚未测得容器宽度，从 0 变为有效列数属于初始布局而不触发动画 */
  readonly columns: number;
  /** 各位置键对应的目标坐标映射 */
  readonly places: ReadonlyMap<string, ReflowPlace>;
  /** 是否启用换列过渡动画；减弱动效偏好或侧边栏切换导致的布局变化直接跳至终点 */
  readonly animate: boolean;
  /**
   * 延迟获取视口几何状态
   * 仅在换列且启用动画时调用，避免在未发生列数变化的常规重排中触发强制同步重排（reflow）
   */
  readonly viewport: () => ReflowViewport;
}

export interface ReflowViewport {
  /** 本次布局变动引起的滚动偏移量变化（换列锚定或高度收缩产生的夹取），单位 CSS 像素 */
  readonly scrolled: number;
  /** 视口可视高度，单位 CSS 像素；换列前后相对视口移动超过该高度的元素改为原地淡入 */
  readonly reach: number;
}

export interface TileReflow {
  /** 布局完成回调；仅在列数发生变化时才遍历提取 elements */
  commit(elements: () => Iterable<ReflowElement>, next: ReflowCommit): void;
}

export function createTileReflow(): TileReflow {
  let columns = 0;
  let places: ReadonlyMap<string, ReflowPlace> = new Map();

  function slide(element: ReflowElement, dx: number, dy: number): void {
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      {
        duration: REFLOW_MOVE.duration,
        easing: REFLOW_MOVE.curve.timing,
        composite: 'add',
      },
    );
  }

  function enter(element: ReflowElement): void {
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: REFLOW_ENTER.duration,
      easing: REFLOW_ENTER.curve.timing,
    });
  }

  return {
    commit(elements, next) {
      const before = places;
      const changed = columns > 0 && next.columns > 0 && next.columns !== columns;
      columns = next.columns;
      places = next.places;
      if (!changed || !next.animate) return;
      const { scrolled, reach } = next.viewport();
      for (const element of elements()) {
        const key = element.dataset['reflowKey'] ?? element.dataset['reflowFollow'];
        const to = key === undefined ? undefined : next.places.get(key);
        if (!key || !to) continue;
        const from = before.get(key);
        // 维持相对视口视觉连续性：逆向补偿布局位移与滚动增量之差
        const dx = from ? Math.round(from.x - to.x) : 0;
        const dy = from ? Math.round(from.y - to.y + scrolled) : 0;
        if (!from || Math.abs(dy) > reach) enter(element);
        else if (dx !== 0 || dy !== 0) slide(element, dx, dy);
      }
    },
  };
}
