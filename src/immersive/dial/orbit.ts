/**
 * 仪表图纸罗盘的转动层，做法照 catbot-3 网页版的罗盘转动：
 * 两圈虚线环顺时针、一圈辐条逆时针，都按墙钟转；四个轨道点跟播放位置走。
 * 算出来的角度一律弧度、从 x 轴顺时针量（canvas 的 y 朝下）；`OrbitSpec` 里轨道点的初始角与每秒进的
 * 角度用度。长度是 CSS 像素，圆心在调用方给的位置。
 */

/**
 * 一套罗盘的转动层尺寸：两圈虚线环、辐条内外端的半径，四个轨道点的半径、初始角（度）与直径，
 * 以及 canvas 的半边长（盖住最外的轨道点再留些余量）。版心档用 `SHEET_ORBIT`，full 档的舞台另有一套。
 */
export interface OrbitSpec {
  dashed: { inner: number; outer: number };
  spokes: { outer: number; innerLong: number; innerShort: number };
  dots: readonly { radius: number; degrees: number; diameter: number }[];
  extent: number;
}

/**
 * 1280 × 800 版心的一套：两圈虚线环分别落在 196–236、236–276 两段环之间，与网页版两圈在各自两环之间的
 * 位置相同；辐条贴最外环 276 内侧；轨道点落在最外环上。
 */
export const SHEET_ORBIT: OrbitSpec = {
  dashed: { inner: 216, outer: 254 },
  spokes: { outer: 272, innerLong: 252, innerShort: 262 },
  dots: [-77, -146, 27, 98].map((degrees) => ({ radius: 276, degrees, diameter: 5 })),
  extent: 300,
};
export const DASHED_RINGS = SHEET_ORBIT.dashed;
/** 虚线的实、空段长。辐条也沿用这一组：网页版画辐条前没复位虚线，辐条也是虚的。 */
export const ORBIT_DASH: readonly number[] = [12, 15];
/** 角速度，弧度每秒，正为顺时针。 */
export const ORBIT_SPEED = { inner: 0.1, spokes: -0.16, outer: 0.065 } as const;
export const SPOKE_COUNT = 24;
/** 版心档轨道点所在的半径（最外环）。 */
export const DOT_RADIUS = 276;
/** 轨道点每秒进 3°。 */
export const DOT_DEGREES_PER_SECOND = 3;
/**
 * 转动层的重画上限（fps）。转得最快的是辐条外端：满尺寸舞台上半径 434、每秒 0.16 弧度，约 70 px/s，
 * 60 fps 下一步约 1.2 px；165 Hz 屏上跟刷新率画，每帧挪不到 0.5 px，多画的帧看不出，
 * 暂停时却只剩这一块在让合成器每个刷新周期出帧。
 */
export const ORBIT_FPS = 60;
export const ORBIT_EXTENT = SHEET_ORBIT.extent;

const TURN = Math.PI * 2;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export interface RingAngles {
  inner: number;
  spokes: number;
  outer: number;
}

/** 墙钟过了 `wallSeconds` 秒时两圈虚线环与整圈辐条各自转到的角度。 */
export function ringAngles(wallSeconds: number): RingAngles {
  return {
    inner: wallSeconds * ORBIT_SPEED.inner,
    spokes: wallSeconds * ORBIT_SPEED.spokes,
    outer: wallSeconds * ORBIT_SPEED.outer,
  };
}

export interface Spoke {
  /** 未转动时的角度。 */
  angle: number;
  /** 内、外端半径。 */
  from: number;
  to: number;
  long: boolean;
}

/** 24 根辐条，每 15° 一根；落在 90° 倍数上的四根长，其余短。 */
export function spokeSegments(spec: OrbitSpec = SHEET_ORBIT): Spoke[] {
  return Array.from({ length: SPOKE_COUNT }, (_, index) => {
    const long = index % (SPOKE_COUNT / 4) === 0;
    return {
      angle: (index * TURN) / SPOKE_COUNT,
      from: long ? spec.spokes.innerLong : spec.spokes.innerShort,
      to: spec.spokes.outer,
      long,
    };
  });
}

/** 播放到 `positionSeconds` 秒时各轨道点的角度。 */
export function dotAngles(positionSeconds: number, spec: OrbitSpec = SHEET_ORBIT): number[] {
  return spec.dots.map((dot) => radians(dot.degrees + positionSeconds * DOT_DEGREES_PER_SECOND));
}

export interface OrbitStyle {
  /** 数据墨：长辐条。 */
  ink: string;
  /** 热色：轨道点。 */
  hot: string;
  /** 中性墨：虚线环与短辐条。 */
  neutral: string;
}

/** 画转动层用到的 canvas 2D 面；`CanvasRenderingContext2D` 满足它。 */
export interface OrbitContext {
  globalAlpha: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  setLineDash(segments: number[]): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
}

export interface OrbitFrame {
  /** canvas 的 CSS 尺寸，清屏用。 */
  width: number;
  height: number;
  cx: number;
  cy: number;
  wallSeconds: number;
  positionSeconds: number;
  /** 半径的缩放，紧凑档罗盘是 0.8；线宽、虚线段长与轨道点大小不缩。缺省 1。 */
  scale?: number;
  /** 缺省 `SHEET_ORBIT`。 */
  spec?: OrbitSpec;
}

/** 清屏后画一帧：虚线环 → 辐条 → 轨道点。透明度照网页版，颜色由调用方从 token 读好传进来。 */
export function drawOrbit(ctx: OrbitContext, frame: OrbitFrame, style: OrbitStyle): void {
  const { cx, cy } = frame;
  const s = frame.scale ?? 1;
  const spec = frame.spec ?? SHEET_ORBIT;
  const angles = ringAngles(frame.wallSeconds);
  ctx.clearRect(0, 0, frame.width, frame.height);

  // 虚线从起始角开始排，起始角跟着转，虚线就转起来了。
  ctx.setLineDash([...ORBIT_DASH]);
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = style.neutral;
  ctx.lineWidth = 1;
  for (const [radius, angle] of [
    [spec.dashed.inner, angles.inner],
    [spec.dashed.outer, angles.outer],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * s, angle, angle + TURN);
    ctx.stroke();
  }

  // 长短两组各走一条路径；虚线按子路径从头排，与逐根画一样。
  const spokes = spokeSegments(spec);
  for (const long of [false, true]) {
    ctx.globalAlpha = long ? 0.7 : 0.22;
    ctx.strokeStyle = long ? style.ink : style.neutral;
    ctx.lineWidth = long ? 1.6 : 1;
    ctx.beginPath();
    for (const spoke of spokes) {
      if (spoke.long !== long) continue;
      const cos = Math.cos(spoke.angle + angles.spokes);
      const sin = Math.sin(spoke.angle + angles.spokes);
      ctx.moveTo(cx + cos * spoke.from * s, cy + sin * spoke.from * s);
      ctx.lineTo(cx + cos * spoke.to * s, cy + sin * spoke.to * s);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.globalAlpha = 1;
  ctx.fillStyle = style.hot;
  dotAngles(frame.positionSeconds, spec).forEach((angle, index) => {
    const dot = spec.dots[index];
    if (!dot) return;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * dot.radius * s,
      cy + Math.sin(angle) * dot.radius * s,
      dot.diameter / 2,
      0,
      TURN,
    );
    ctx.fill();
  });
}
