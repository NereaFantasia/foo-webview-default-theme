/**
 * Coverflow 槽位空间几何计算与插值纯函数
 *
 * 焦点项位于槽位 0，两侧各保留 3 个可见渲染槽；距离与尺寸以当前视心封面边长为归一化基准（1.0），
 * 随视口与封面缩放整体等比缩放
 */

/** 画稿基准封面边长（像素），供透视比率折算 */
export const REFERENCE_COVER = 320;
/** 基准封面边长对应的透视景深（像素） */
export const REFERENCE_PERSPECTIVE = 900;
/** 最大有效渲染半径阈值（|d| 达到此值的卡片不渲染） */
export const RENDER_RADIUS = 4;

/** 卡片空间姿态瞬时状态 */
export interface Pose {
  /** 中心离视心中线的水平相对位移（归一化为封面边长比例） */
  readonly offset: number;
  /** 相对边长比例 */
  readonly size: number;
  /** rotateY 偏转角（度） */
  readonly tilt: number;
  readonly opacity: number;
  /** 远端阴影遮罩不透明度 */
  readonly shade: number;
}

interface SlotSpec {
  readonly offset: number;
  readonly size: number;
  /** 偏转角绝对值（符号由所在侧决定） */
  readonly angle: number;
  readonly opacity: number;
  readonly shade: number;
}

/**
 * 预定义离散槽位规格表（索引对应 |d|，最后一项为远端淡出插值终点）。位置量自画稿 30F；边长与倾角
 * 2026-10-25 起比画稿小一档（画稿是 0.7、0.5、0.35 与 28°、36°、42°），封面放大后侧封面叠得太密、转得太狠
 */
const SLOTS: readonly SlotSpec[] = [
  { offset: 0, size: 1, angle: 0, opacity: 1, shade: 0 },
  { offset: 0.9375, size: 0.62, angle: 20, opacity: 0.95, shade: 0.48 },
  { offset: 1.375, size: 0.44, angle: 26, opacity: 0.8, shade: 0.53 },
  { offset: 1.75, size: 0.31, angle: 30, opacity: 0.6, shade: 0.58 },
  { offset: 2.0625, size: 0.22, angle: 30, opacity: 0, shade: 0.58 },
];

/**
 * 非落点的封面至少压暗到这一档（紧挨选中项的那一级侧封面的暗层）。滚动途中封面经过中间位置不取消压暗，
 * 只有确定的落点那一首才去掉，见 `engine.ts` 的点亮系数
 */
export const DIM_SHADE = (SLOTS[1] as SlotSpec).shade;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * 计算相对偏移 d 处的卡片空间几何姿态
 *
 * 整数槽位取规格表预设值，槽间采用线性插值，使位移、缩放、倾角、透明度与遮罩进度保持同步；
 * 左右两侧卡片绕 Y 轴呈镜像对称偏转；|d| 达到或超过 RENDER_RADIUS 时返回远端不可见槽位
 */
export function slotAt(d: number): Pose {
  const distance = Math.min(Math.abs(d), RENDER_RADIUS);
  const low = Math.min(Math.floor(distance), RENDER_RADIUS - 1);
  const t = distance - low;
  const from = SLOTS[low] as SlotSpec;
  const to = SLOTS[low + 1] as SlotSpec;
  const side = d < 0 ? -1 : 1;
  return {
    offset: side * lerp(from.offset, to.offset, t),
    size: lerp(from.size, to.size, t),
    tilt: -side * lerp(from.angle, to.angle, t),
    opacity: lerp(from.opacity, to.opacity, t),
    shade: lerp(from.shade, to.shade, t),
  };
}

/** 离选中项 `distance` 条的封面在视图范围内：两侧各 3 条以内（3 到 4 之间向远端淡出，到 4 就看不见了） */
export function inViewRange(distance: number): boolean {
  return Math.abs(distance) <= RENDER_RADIUS - 1;
}

/** 计算指定浏览位置下的可见条目下标范围（双闭区间） */
export function visibleRange(pos: number, count: number): readonly [number, number] {
  const first = Math.max(0, Math.floor(pos - RENDER_RADIUS) + 1);
  const last = Math.min(count - 1, Math.ceil(pos + RENDER_RADIUS) - 1);
  return [first, last];
}

/**
 * 计算从 from 补间至 to 期间需要渲染的条目下标集合（升序）
 *
 * 取起点与终点可见窗口的并集；大跨度跳转（如回位至正在播放）时不渲染中间过渡卡片，
 * 由两端自然淡入淡出衔接，避免发起大量无意义封面请求
 */
export function visibleIndexes(from: number, to: number, count: number): number[] {
  const indexes = new Set<number>();
  for (const pos of [from, to]) {
    const [first, last] = visibleRange(pos, count);
    for (let index = first; index <= last; index++) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

/** 封面边长占窗高的比例：1280 × 800 时 400，与分栏预设的封面同大，进出模式时封面不先缩后放 */
const COVER_HEIGHT_SHARE = 0.5;
/** 封面上沿最小留白高度（避让顶部控制按键） */
const TOP_MIN = 56;
/** 封面下沿预留垂直空间（间隔 24px、主副标题 76px、窗底 24px） */
const BELOW_COVER = 124;
/** 封面宽度占舞台最大比例（确保两侧留白） */
const COVER_WIDTH_SHARE = 0.8;
/** 最外一级侧封面的脸外沿离中线，占当前封面边长：槽位偏移加半个脸宽 */
const OUTER_REACH = (() => {
  const outer = SLOTS[RENDER_RADIUS - 1] as SlotSpec;
  return outer.offset + outer.size / 2;
})();

export interface CoverflowLayout {
  /** 焦点封面边长（像素） */
  readonly cover: number;
  /** 焦点封面上沿距舞台顶部距离（像素） */
  readonly top: number;
  /** 侧封面水平间距的收紧系数，1 是槽位表原样；窗宽不够时小于 1，让三级侧封面都留在窗内 */
  readonly spread: number;
  /** 等比折算透视景深（像素） */
  readonly perspective: number;
}

/**
 * 依据舞台尺寸换算焦点封面边长、垂直定位、侧封面间距与透视距离
 *
 * 封面边长取窗高的一半，受放得下标题的窗高预留与窗宽比例约束；封面中线落在窗口中线上，
 * 下面放不下间隔与标题时才往上让，上沿不低于避让顶部按键的位置；窗宽不够放下最外一级侧封面时，
 * 侧封面的水平间距按比例收紧；数值取整以避免次像素模糊抖动
 */
export function coverflowLayout(frame: {
  readonly width: number;
  readonly height: number;
}): CoverflowLayout {
  const cover = Math.max(
    0,
    Math.floor(
      Math.min(
        frame.height * COVER_HEIGHT_SHARE,
        frame.height - TOP_MIN - BELOW_COVER,
        frame.width * COVER_WIDTH_SHARE,
      ),
    ),
  );
  const centered = Math.round((frame.height - cover) / 2);
  const top = Math.max(TOP_MIN, Math.min(centered, frame.height - BELOW_COVER - cover));
  const spread = cover > 0 ? Math.min(1, frame.width / 2 / (cover * OUTER_REACH)) : 1;
  return { cover, top, spread, perspective: (REFERENCE_PERSPECTIVE * cover) / REFERENCE_COVER };
}
