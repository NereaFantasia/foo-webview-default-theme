/**
 * 满幅封面右缘的羽化：圆心钉在封面左缘中点的径向渐变做 mask，横向半径大，渐变弧线只落在右缘一条带，
 * 封面主体全程不透明。几何取自 nereal 的定稿参数（径向、弯曲 100、羽化 38–80–95）：
 * 清晰层从 38% 起渐隐、在 80% 处归零，模糊层晚一点、到 95% 才归零，中段露出纯模糊、尾段透出背景
 */

/** 椭圆半径与内圈止点：半径是盒宽、盒高的百分数，内圈止点是半径的比例（0 到 1） */
export interface FeatherShape {
  readonly rx: number;
  readonly ry: number;
  readonly inner: number;
}

/** 模糊层比清晰层晚归零多少，盒宽的百分数：中段露出纯模糊，尾段透出背景 */
const BLUR_EXTRA = 15;

/** 椭圆纵横半径比：弯曲 100 时 6 − 100% × 4.7 = 1.3 */
const ASPECT = 1.3;

/** 模糊层放大的倍数，补偿 blur 采样让边缘收缩的那一圈；mask 的百分比是元素自身坐标，放大后要换算 */
export const BLUR_SCALE = 1.06;

/** 渐隐段取多少个点 */
const FADE_POINTS = 15;

/**
 * 渐隐偏向不透明的程度：不透明度取 1 − s^HOLD（s 是五次平滑曲线），大于 1 时同一位置比纯平滑曲线更不透明，
 * 羽化带里透出的背景更少。两端斜率仍为零，端点不变（内圈内全不透明、100% 处全透明），只是中段更晚褪下去；
 * 1 就是纯五次平滑曲线
 */
export const FEATHER_HOLD = 1.4;

function shapeOf(start: number, end: number): FeatherShape {
  return { rx: end, ry: end * ASPECT, inner: start / end };
}

/** 盒子坐标换算成放大后元素的自身坐标，放大以盒心为原点 */
function toSelf(percent: number, scale: number): number {
  return 50 + (percent - 50) / scale;
}

/**
 * 两层羽化的几何，起点与宽度是盒宽的百分数：清晰层从 `start` 起渐隐、`start + width` 处归零（至多 98）；
 * 模糊层晚 15 个百分点归零（至多 100），并按放大倍数换算，归零点仍在盒内，不被右界截成硬边。
 * 终点由起点加宽度算出，三者的先后次序天然成立
 */
export function featherShapes(
  start: number,
  width: number,
): { readonly sharp: FeatherShape; readonly blur: FeatherShape } {
  const end = Math.min(98, start + width);
  const blurEnd = Math.min(100, end + BLUR_EXTRA);
  return {
    sharp: shapeOf(start, end),
    blur: shapeOf(toSelf(start, BLUR_SCALE), toSelf(blurEnd, BLUR_SCALE)),
  };
}

/** 缺省的羽化：38 起、宽 42，清晰层 80 归零、模糊层 95 归零 */
const DEFAULT_SHAPES = featherShapes(38, 42);
export const SHARP_FEATHER: FeatherShape = DEFAULT_SHAPES.sharp;
export const BLUR_FEATHER: FeatherShape = DEFAULT_SHAPES.blur;

/** 五次平滑曲线 6t⁵ − 15t⁴ + 10t³，两端斜率为零 */
function smoother(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const trim = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * 径向 mask 的取值：内圈内全不透明，内圈到边缘按五次平滑曲线渐隐到全透明
 *
 * 折线的斜率在转折处突变会露出台阶，Chromium 对 `mask-image` 的渐变又不做抖动，所以渐隐段取 15 个点，
 * 并按 `hold`（缺省 `FEATHER_HOLD`）偏向不透明。色取 Fluent 前景色，只用它的透明度，不写字面色值
 */
export function featherMask(shape: FeatherShape, hold: number = FEATHER_HOLD): string {
  const stops = [`var(--colorNeutralForeground1) ${trim(shape.inner * 100)}%`];
  for (let index = 1; index < FADE_POINTS; index += 1) {
    const t = index / FADE_POINTS;
    const alpha = Math.round((1 - smoother(t) ** hold) * 1000) / 10;
    const at = (shape.inner + t * (1 - shape.inner)) * 100;
    stops.push(
      `color-mix(in srgb, var(--colorNeutralForeground1) ${trim(alpha)}%, transparent) ${trim(at)}%`,
    );
  }
  stops.push('transparent 100%');
  return `radial-gradient(ellipse ${trim(shape.rx)}% ${trim(shape.ry)}% at 0% 50%, ${stops.join(', ')})`;
}
