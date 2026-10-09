/**
 * 频谱山脊图：`audio:spectrum` 的历史帧存成环形缓冲，画成由近到远的一排排曲线。
 * 纯函数，canvas 2D 上下文由调用方注入，只经 `TerrainContext` 这一面画。
 *
 * 只描边、天际线消隐（`skyline.ts`）：行从最近（k = 0）画到最远（k = rows − 1），每行只画高出前面各行
 * 合成轮廓的段，画完把自己并进轮廓；两侧竖边与基线的可见段照画，外观与闭合到基线的多边形一致。
 * 不用纸色填充来遮挡：每行一块抗锯齿凹多边形会让 GPU 进程成为瓶颈；不做半透明叠加：叠加会让密处发白。
 *
 * 行可以落在小数位置：帧与帧之间按显示刷新率重画，行从近处滑向远处，`offset` 就是这段
 * 滑动的进度。每行的点用经过相邻中点的二次曲线连：山脊图一行 384 点，1280 宽上 3.3 px 一段，曲线把段与段的折角抹掉；
 * 曲线在 `skyline.ts` 里细分成折线再画，消隐要逐列取 y；整段被前面各行挡住的曲线段在细分时就跳过。
 */
import {
  createPolyline,
  createSkyline,
  type PathContext,
  polylineCapacity,
  tracePolyline,
} from './skyline.ts';

/**
 * 行数。一帧进一行，历史长度随实得帧率变：订 60 实得约 32 fps 时约 3.8 s，宿主限流到 12 fps 时约 10 s。
 * 作参照的 musicvid.org LineBed 是 200 行、每两帧进一行。
 */
export const TERRAIN_ROWS = 120;
/**
 * `createSpectrumHistory` 缺省的每行点数，也是与图纸频谱柱共用的那份缓冲的宽度：1024 带的订阅帧写入时
 * 分组均值落到这里，频谱柱再并成 96 根。山脊图自己的缓冲按整形链的点数另建，不用这个值。
 */
export const TERRAIN_BANDS = 256;
/** 最远一行占画面宽度的比例；最近一行满宽。 */
export const FAR_WIDTH = 0.7;
/** 线的透明度：最近一行到最远一行线性过渡；远端没再往下压，1 px 线在 4% 透明度下几乎看不见。 */
export const ALPHA_NEAR = 0.35;
export const ALPHA_FAR = 0.1;
/**
 * 最近一行满幅的峰高占画面高度的比例；远处按透视再打对折。只缩放起伏高度，不改曲线形状；
 * 整形链幂压缩后常见值只有满幅的 0.05…0.3。
 */
export const AMPLITUDE = 0.5;
/** 地平线（最远一行基线）在画面高度里的位置：340 / 800；`HORIZON_RATIO_ALT` 的 420 / 800 是备选值，目前没有调用方。 */
export const HORIZON_RATIO = 0.425;
export const HORIZON_RATIO_ALT = 0.525;

export interface SpectrumHistory {
  readonly rows: number;
  readonly bands: number;
  /** `rows × bands`，按物理行存；逻辑行序经 `row(k)` 读。 */
  readonly data: Float32Array;
  /** 最新一帧所在的物理行。 */
  readonly head: number;
  /** 已收到的帧数（不封顶），供消费者判断缓冲是否还是空的。 */
  readonly count: number;
  /**
   * 写入一帧；比 `bands` 长就分组均值，短就最近邻重采样，非数与越界值夹到 0…1。
   * `retention` 0…1 是与上一帧的指数混合：新行 = 上一行 × retention + 本帧 × (1 − retention)，
   * 缓冲空着时不混。
   */
  push(frame: ArrayLike<number>, retention?: number): void;
  /** 逻辑行 k：0 是最新一帧，`rows − 1` 是最旧一帧；返回的是缓冲上的视图，不拷贝。 */
  row(k: number): Float32Array;
  /** 撤销缓冲引用并清零行数；下一次写入时重新分配。已交出的行视图由消费者释放。 */
  release(): void;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function createSpectrumHistory(rows = TERRAIN_ROWS, bands = TERRAIN_BANDS): SpectrumHistory {
  let data = new Float32Array(rows * bands);
  let head = 0;
  let count = 0;
  return {
    rows,
    bands,
    get data() {
      return data;
    },
    get head() {
      return head;
    },
    get count() {
      return count;
    },
    push(frame, retention = 0) {
      if (data.length === 0) data = new Float32Array(rows * bands);
      const previous = count > 0 ? data.subarray(head * bands, (head + 1) * bands) : null;
      const keep = previous && retention > 0 ? Math.min(1, retention) : 0;
      head = (head + rows - 1) % rows;
      count += 1;
      const target = data.subarray(head * bands, (head + 1) * bands);
      // 只有一行的缓冲里 previous 与 target 是同一段内存：逐点先读后写，顺序上没有问题。
      const write = (index: number, value: number): void => {
        target[index] =
          keep && previous ? (previous[index] ?? 0) * keep + value * (1 - keep) : value;
      };
      const length = frame.length;
      if (length === 0) {
        for (let index = 0; index < bands; index += 1) write(index, 0);
        return;
      }
      if (length === bands) {
        for (let index = 0; index < bands; index += 1) write(index, clamp01(frame[index] ?? 0));
        return;
      }
      if (length > bands) {
        // 宿主给的带比行宽多（山脊图为了近乎原始的 bin 订了 1024 带）：分组取均值。跳着取最近邻会让频谱柱抖成雪花。
        const ratio = length / bands;
        for (let index = 0; index < bands; index += 1) {
          const start = Math.floor(index * ratio);
          const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
          let sum = 0;
          for (let source = start; source < end; source += 1) sum += clamp01(frame[source] ?? 0);
          write(index, sum / (end - start));
        }
        return;
      }
      // 最近邻：宿主给 48 带也能画，只是横向粗一倍；不插值，插值会把峭壁抹圆。
      const step = bands > 1 ? (length - 1) / (bands - 1) : 0;
      for (let index = 0; index < bands; index += 1) {
        write(index, clamp01(frame[Math.round(index * step)] ?? 0));
      }
    },
    row(k) {
      const physical = (head + k) % rows;
      return data.subarray(physical * bands, (physical + 1) * bands);
    },
    release() {
      data = new Float32Array(0);
      head = 0;
      count = 0;
    },
  };
}

/** 画山脊图用到的 canvas 2D 面；`CanvasRenderingContext2D` 与 `OffscreenCanvasRenderingContext2D` 都满足它。 */
export interface TerrainContext extends PathContext {
  globalAlpha: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  stroke(): void;
}

export interface TerrainDrawOptions {
  /** 画面尺寸，CSS 像素；ctx 已由调用方按 DPR 缩放。 */
  width: number;
  height: number;
  /** 最远一行基线的 y（CSS 像素），一般取 `height × HORIZON_RATIO`。 */
  horizon: number;
  /** 线色，不带透明度（透明度走 `globalAlpha`）。 */
  lineColor: string;
  alphaNear?: number;
  alphaFar?: number;
  farWidth?: number;
  amplitude?: number;
  /** `devicePixelRatio`：线宽换成 1 物理像素要它。 */
  pixelRatio?: number;
  /** 相邻三点均值的空间平滑，缺省关。 */
  smooth?: boolean;
  /** 行位置的小数偏移 0…1：行 k 画在 k + offset 处，滑过最远一行的不画。 */
  offset?: number;
  /** 点之间用经过中点的二次曲线连，缺省开；关掉是直线段。 */
  curve?: boolean;
  /**
   * 曲线细分的容差（CSS 像素），缺省 0 即每段恒切 4 份。大于 0 时平缓的段少切，见 `tracePolyline`；
   * 与恒切 4 份画出来的差不超过容差的两倍。
   */
  flatness?: number;
}

/**
 * 行 k（0 最近 … rows − 1 最远，可以是小数）的几何：基线 y、宽、幅度、透明度。
 * 基线按「近」的平方走，等深的行越远越挤，是透视该有的样子；另一种写法 `1 − (1 − t)²`
 * 会反过来把近处压密，不合「远处行距密、近处疏」，所以不用。
 */
export function rowGeometry(
  k: number,
  rows: number,
  options: Required<Pick<TerrainDrawOptions, 'width' | 'height' | 'horizon'>> &
    Pick<TerrainDrawOptions, 'alphaNear' | 'alphaFar' | 'farWidth' | 'amplitude'>,
): { baseline: number; width: number; amplitude: number; alpha: number } {
  const last = Math.max(1, rows - 1);
  const near = Math.max(0, 1 - k / last);
  const farWidth = options.farWidth ?? FAR_WIDTH;
  const alphaNear = options.alphaNear ?? ALPHA_NEAR;
  const alphaFar = options.alphaFar ?? ALPHA_FAR;
  return {
    baseline: options.horizon + (options.height - options.horizon) * near ** 2,
    width: options.width * (farWidth + (1 - farWidth) * near),
    amplitude: (options.amplitude ?? AMPLITUDE) * options.height * (0.5 + 0.5 * near),
    alpha: alphaFar + (alphaNear - alphaFar) * near,
  };
}

const smoothed = (values: Float32Array): Float32Array => {
  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const prev = values[Math.max(0, index - 1)] ?? 0;
    const next = values[Math.min(values.length - 1, index + 1)] ?? 0;
    out[index] = ((values[index] ?? 0) + prev + next) / 3;
  }
  return out;
};

export function drawTerrain(
  ctx: TerrainContext,
  history: SpectrumHistory,
  options: TerrainDrawOptions,
): void {
  ctx.clearRect(0, 0, options.width, options.height);
  if (history.count === 0) return;
  ctx.lineWidth = 1 / (options.pixelRatio ?? 1);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = options.lineColor;
  const points = Math.max(2, history.bands);
  const drawn = Math.min(history.rows, history.count);
  const offset = Math.min(1, Math.max(0, options.offset ?? 0));
  const curve = options.curve ?? true;
  const flatness = options.flatness ?? 0;
  const skyline = createSkyline(options.width);
  const line = createPolyline(polylineCapacity(points, curve));
  for (let k = 0; k < drawn; k += 1) {
    const position = k + offset;
    // 滑过最远一行的那一行已经出了地平线；再往后的行更远，一并不画。
    if (position > history.rows - 1) break;
    const geometry = rowGeometry(position, history.rows, options);
    const values = options.smooth ? smoothed(history.row(k)) : history.row(k);
    const left = (options.width - geometry.width) / 2;
    const right = left + geometry.width;
    const step = geometry.width / (points - 1);
    tracePolyline(
      (index) => left + index * step,
      (index) => geometry.baseline - geometry.amplitude * (values[index] ?? 0),
      points,
      curve,
      line,
      flatness,
      skyline,
    );
    ctx.globalAlpha = geometry.alpha;
    ctx.beginPath();
    skyline.strokeVisible(ctx, line);
    // 外观要等同闭合到基线的多边形：两侧竖边（曲线端点到基线）与基线的可见段照画。
    const sides: [number, number][] = [
      [left, line.firstY],
      [right, line.lastY],
    ];
    for (const [x, top] of sides) {
      const bottom = Math.min(geometry.baseline, skyline.at(x));
      if (bottom > top) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
    }
    skyline.strokeLevel(ctx, geometry.baseline, left, right);
    ctx.stroke();
    skyline.raise(line);
  }
  ctx.globalAlpha = 1;
}
