/**
 * 图纸封面底色的网格变形流动：画的就是封面本身，贴在一张 `GRID` × `GRID` 控制点的网格上，控制点各自
 * 慢慢漂移，控制点之间按 Catmull-Rom 双三次插值出平滑的位移场，整幅封面只做大尺度、平滑的弯曲；
 * 整幅再绕中心缓慢旋转（`ROTATION_PERIOD`），放大 1/`ZOOM` 倍，免得转到的角落露出太多镜像边。
 * 源图事先重度模糊、再经放大采样，人脸与文字认不出来，颜色原样来自封面。
 * 思路来自 Apple Music「正在播放」的背景：封面贴在可变形网格上、再整体大半径模糊；参数是这里自己定的。
 * 用漩涡拧转代替网格会拧出螺旋状细条纹，所以位移场只允许大尺度弯曲。
 *
 * 坐标：纹理坐标以封面为 0–1、y 向下，超出范围按镜像取（着色器用 MIRRORED_REPEAT，这里的 `sampleCover` 同样处理）。
 * 画面按「铺满」对到封面上：长边对满封面，短边居中裁掉。`warp` / `sampleCover` / `shade` 与 `warpShader.ts`
 * 的片元着色器是同一套算法：着色器负责流动档，这里负责静态档；改其中一边必须同步另一边。
 */

/** 源图边长：要 2 的幂，WebGL 1 才允许镜像环绕。 */
export const SOURCE_SIZE = 128;
/** 源图预糊的盒式模糊半径（源图像素）与遍数，三遍盒式接近高斯；糊到只剩大块色域。 */
export const SOURCE_BLUR = 9;
const BLUR_PASSES = 3;

/** 控制点网格每边的点数，均匀铺在纹理坐标 0–1 上。 */
export const GRID = 4;

/** 一个控制点的漂移：两个方向各一条正弦，幅度按纹理坐标、周期按秒。 */
export interface ControlMotion {
  ax: number;
  ay: number;
  px: number;
  py: number;
  phx: number;
  phy: number;
}

/**
 * 漂移幅度与周期的取值范围。幅度约为控制点间距（1/3）的四成到七成，要大到看得出在流：再小的话按比例
 * 混进纸面后屏幕上每秒变不到一个色阶，看不出动。相邻点反向时偶尔会翻折；采样是由画面反查封面，翻折只让一小块
 * 封面重复出现，重度模糊下不显眼。
 */
const AMPLITUDE = [0.14, 0.24] as const;
const PERIOD = [27, 53] as const;
/** 整幅旋转一圈的秒数，与采样放大倍数的倒数。 */
export const ROTATION_PERIOD = 75;
export const ZOOM = 0.8;
const MOTION_SEED = 20260923;

/** 固定种子生成每个控制点的漂移参数：所有封面共用同一套动法，每次进来都一样。 */
function buildMotion(): ControlMotion[] {
  let state = MOTION_SEED;
  const next = () => {
    // xorshift32：只要均匀、可复现。
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 0x100000000;
  };
  const range = ([low, high]: readonly [number, number]) => low + (high - low) * next();
  return Array.from({ length: GRID * GRID }, () => ({
    ax: range(AMPLITUDE),
    ay: range(AMPLITUDE),
    px: range(PERIOD),
    py: range(PERIOD),
    phx: 2 * Math.PI * next(),
    phy: 2 * Math.PI * next(),
  }));
}

export const CONTROL_MOTION: readonly ControlMotion[] = buildMotion();

/** 某一时刻各控制点的位移，按行优先排成 [dx0, dy0, dx1, dy1, …]，每帧算一次交给着色器。 */
export function controlOffsets(
  seconds: number,
  motion: readonly ControlMotion[] = CONTROL_MOTION,
): Float32Array {
  const offsets = new Float32Array(motion.length * 2);
  motion.forEach((point, index) => {
    offsets[index * 2] = point.ax * Math.sin((2 * Math.PI * seconds) / point.px + point.phx);
    offsets[index * 2 + 1] = point.ay * Math.sin((2 * Math.PI * seconds) / point.py + point.phy);
  });
  return offsets;
}

/** Catmull-Rom 插值核（Keys 三次卷积核，a = −0.5）：整数点上为 1 / 0，插值曲线穿过控制点。 */
export function keys(t: number): number {
  const x = Math.abs(t);
  if (x <= 1) return (1.5 * x - 2.5) * x * x + 1;
  if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
  return 0;
}

/** 网格坐标 `g`（0 到 GRID − 1）处第 `column` 列的权重；越界的虚拟邻点按夹边算到两端的点上。 */
function weightAt(g: number, column: number): number {
  let weight = keys(g - column);
  if (column === 0) weight += keys(g + 1);
  if (column === GRID - 1) weight += keys(g - GRID);
  return weight;
}

/** 画面像素（中心点）对到封面的纹理坐标：长边对满，短边居中。 */
export function coverUv(x: number, y: number, width: number, height: number): [number, number] {
  const long = Math.max(width, height);
  return [(x - width / 2) / long + 0.5, (y - height / 2) / long + 0.5];
}

/** 某一时刻的整幅旋转角，弧度。 */
export function rotationAt(seconds: number): number {
  return (2 * Math.PI * seconds) / ROTATION_PERIOD;
}

/**
 * 纹理坐标 (u, v) 的采样坐标：先绕中心按 `angle` 旋转并放大，再经位移场变形。`offsets` 来自 `controlOffsets`，
 * `angle` 来自 `rotationAt`。
 */
export function warp(u: number, v: number, offsets: Float32Array, angle: number): [number, number] {
  const du = (u - 0.5) * ZOOM;
  const dv = (v - 0.5) * ZOOM;
  const ru = 0.5 + du * Math.cos(angle) - dv * Math.sin(angle);
  const rv = 0.5 + du * Math.sin(angle) + dv * Math.cos(angle);
  const gx = Math.min(1, Math.max(0, ru)) * (GRID - 1);
  const gy = Math.min(1, Math.max(0, rv)) * (GRID - 1);
  let dx = 0;
  let dy = 0;
  for (let row = 0; row < GRID; row += 1) {
    const wy = weightAt(gy, row);
    for (let column = 0; column < GRID; column += 1) {
      const weight = wy * weightAt(gx, column);
      const at = (row * GRID + column) * 2;
      dx += weight * (offsets[at] ?? 0);
      dy += weight * (offsets[at + 1] ?? 0);
    }
  }
  return [ru + dx, rv + dy];
}

/** 镜像环绕：…3 2 1 0 | 0 1 2 3 | 3 2 1 0…，与 WebGL 的 MIRRORED_REPEAT 一致。 */
function mirror(index: number, size: number): number {
  const period = size * 2;
  const wrapped = ((index % period) + period) % period;
  return wrapped < size ? wrapped : period - 1 - wrapped;
}

/** 按纹理坐标双线性取源图的 sRGB 字节值（未量化的浮点）。 */
export function sampleCover(
  pixels: Uint8ClampedArray,
  size: number,
  u: number,
  v: number,
): [number, number, number] {
  const fx = u * size - 0.5;
  const fy = v * size - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const result: [number, number, number] = [0, 0, 0];
  const corners = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const;
  for (const [cx, cy, weight] of corners) {
    const at = (mirror(cy, size) * size + mirror(cx, size)) * 4;
    result[0] += (pixels[at] ?? 0) * weight;
    result[1] += (pixels[at + 1] ?? 0) * weight;
    result[2] += (pixels[at + 2] ?? 0) * weight;
  }
  return result;
}

/** 提饱和的倍数：源图预糊、再按比例混进纸面，颜色会淡一截。 */
export const SATURATION = 1.15;

function decode(byte: number): number {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function encode(linear: number): number {
  const v = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

/**
 * 源图颜色（sRGB 字节值）在线性光下提饱和、按 `strength` 混进纸面色（线性光 0–1），回到 sRGB 0–1、未量化。
 * 与着色器的末段一致。
 */
export function shade(
  color: readonly [number, number, number],
  paper: readonly [number, number, number],
  strength: number,
  saturation = SATURATION,
): [number, number, number] {
  const linear = color.map(decode);
  const luma = 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  return [0, 1, 2].map((channel) => {
    const saturated = Math.max(0, luma + ((linear[channel] ?? 0) - luma) * saturation);
    const base = paper[channel] ?? 0;
    return encode(base + (saturated - base) * strength);
  }) as [number, number, number];
}

/** 源图预糊：逐行、逐列各做 `BLUR_PASSES` 遍盒式模糊，边界按镜像取，与纹理环绕方式一致。原地改写。 */
export function blurSource<T extends Uint8ClampedArray>(
  pixels: T,
  size: number,
  radius = SOURCE_BLUR,
): T {
  const line = new Float32Array(size * 3);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < BLUR_PASSES; pass += 1) {
    for (const horizontal of [true, false]) {
      for (let row = 0; row < size; row += 1) {
        const at = (index: number) =>
          horizontal
            ? (row * size + mirror(index, size)) * 4
            : (mirror(index, size) * size + row) * 4;
        for (let index = 0; index < size; index += 1) {
          let red = 0;
          let green = 0;
          let blue = 0;
          for (let offset = -radius; offset <= radius; offset += 1) {
            const source = at(index + offset);
            red += pixels[source] ?? 0;
            green += pixels[source + 1] ?? 0;
            blue += pixels[source + 2] ?? 0;
          }
          line.set([red / span, green / span, blue / span], index * 3);
        }
        for (let index = 0; index < size; index += 1) {
          const target = at(index);
          pixels[target] = line[index * 3] ?? 0;
          pixels[target + 1] = line[index * 3 + 1] ?? 0;
          pixels[target + 2] = line[index * 3 + 2] ?? 0;
        }
      }
    }
  }
  return pixels;
}
