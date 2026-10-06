/**
 * 天际线消隐：山脊图从近到远逐行只描边，每行只画高出「已画各行合成轮廓」的
 * 那些段。轮廓按 CSS 像素列存当前最高点（y 最小），一行画完再并进去。不用先填充再描边的画家算法：
 * 每行一块抗锯齿凹多边形填充会把 GPU 进程压满，60 行时全屏实测只剩 31 fps；只描边能跑到显示器刷新率上限。
 *
 * 曲线先细分成折线：轮廓要逐列取 y、可见性翻转处要把线切开，样条两件都做不到，折线一次到位。
 * 细分时给了轮廓，整段被挡住的曲线段直接跳过：不细分、不判可见、不并进轮廓，折线在那里断开。
 * 山脊图远处的行大多被近处挡住，这样省下大半点数；画出来与不跳过逐笔相同（判据见 `tracePolyline`）。
 * 不碰 canvas 的状态，只经 `PathContext` 的 `moveTo` / `lineTo` 接路径，`beginPath` / `stroke` 由调用方做。
 */

/**
 * 每段二次曲线细分的份数（给了容差时是上限）：山脊图 384 点在 1280 宽上 3.3 px 一段，切 4 份不到 1 px，
 * 肉眼分不出与真曲线的差。
 */
export const CURVE_SUBDIVISIONS = 4;
/** 「还没画过」的轮廓高度。够大就行，不用 Infinity：插值时 Infinity × 0 是 NaN，会把可见点误判成隐藏。 */
const OPEN = 1e9;
/**
 * 判整段被挡住时留的余量（像素）。折线的点按 float32 存，坐标上千时取整误差约 1e-4 px；
 * 余量比它大两个数量级，判成被挡住的段在取整之后也一定不可见、不会抬高轮廓。
 */
const OCCLUSION_MARGIN = 0.01;

export interface Polyline {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** 有效点数；数组按最大可能长度分配，行与行之间复用。 */
  length: number;
  /**
   * 各段在数组里的起点，前 `runs` 个有效。整段被挡住的曲线段不进数组，折线在那里断开，断开的两边不相连；
   * 没有跳过时只有一段、从 0 起。
   */
  readonly starts: Int32Array;
  runs: number;
  /** 首末两个原始点的 y，取整同数组里存的：它们所在的段被跳过时不在数组里，画两侧竖边要用。 */
  firstY: number;
  lastY: number;
}

/** 细分时用来判「整段被挡住」的轮廓；`Skyline` 满足它。 */
export interface Occluder {
  /** `x0…x1` 所跨各列（连同插值会读到的右邻列）里轮廓最低处的 y，即最大的那个。 */
  lowestIn(x0: number, x1: number): number;
}

export interface PathContext {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}

export const polylineCapacity = (points: number, curve: boolean): number =>
  curve && points > 2 ? (points - 2) * CURVE_SUBDIVISIONS + 2 : points;

export function createPolyline(capacity: number): Polyline {
  return {
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    length: 0,
    starts: new Int32Array(Math.max(1, capacity)),
    runs: 1,
    firstY: 0,
    lastY: 0,
  };
}

/** 离弦距离为 `bend` 的一段切几份；容差不大于 0 时恒切满。 */
const partsFor = (bend: number, tolerance: number): number =>
  tolerance > 0
    ? Math.min(CURVE_SUBDIVISIONS, Math.max(1, Math.ceil(Math.sqrt(bend / tolerance))))
    : CURVE_SUBDIVISIONS;

/**
 * 把 n 个点连成折线写进 `out`。`curve` 开：P₀ 起，以 Pᵢ 为控制点、Pᵢ 与 Pᵢ₊₁ 的中点为端点的二次曲线
 * （贴着点走、不过冲），每段切 `CURVE_SUBDIVISIONS` 份，末段直线到 Pₙ₋₁；关：就是这 n 个点本身。
 *
 * `tolerance`（与坐标同单位）大于 0 时按段自适应：同一参数处二次曲线与弦最多差 d = |S − 2C + E| / 4，
 * 按参数均分 n 份后折线离曲线不超过 d / n²，取让它不超过容差的最小 n（1…4）。平缓的段只剩弦，
 * 线段数与描边开销随之下降。首段从 P₀ 起、参数走得不均匀，按参数量偏保守，通常仍切满。
 *
 * 给了 `occluder` 时先判每段是否整段被挡住：二次曲线落在起点、控制点、终点三点的凸包里，凸包最高点
 * （y 最小）不高于这段所跨各列轮廓的最低处，段上每个点就都在轮廓下面，这段不出线、也不抬高轮廓，
 * 整段跳过，折线在这里断开（`starts` / `runs`）。断开处两侧的点都被挡住，按段各走一遍 `strokeVisible` /
 * `raise`，与不跳过时逐笔相同。
 */
export function tracePolyline(
  xAt: (index: number) => number,
  yAt: (index: number) => number,
  points: number,
  curve: boolean,
  out: Polyline,
  tolerance = 0,
  occluder?: Occluder,
): void {
  let length = 0;
  let runs = 0;
  let open = false;
  const push = (x: number, y: number): void => {
    out.x[length] = x;
    out.y[length] = y;
    length += 1;
  };
  const hidden = (fromX: number, toX: number, top: number): boolean =>
    occluder !== undefined && occluder.lowestIn(fromX, toX) <= top - OCCLUSION_MARGIN;
  // 接一段之前：前一段被跳过（或这是第一段）就在段起点另起一段。
  const begin = (x: number, y: number): void => {
    if (open) return;
    out.starts[runs] = length;
    runs += 1;
    open = true;
    push(x, y);
  };
  const firstX = xAt(0);
  const firstY = yAt(0);
  const lastX = xAt(points - 1);
  const lastY = yAt(points - 1);
  out.firstY = Math.fround(firstY);
  out.lastY = Math.fround(lastY);
  if (curve && points > 2) {
    let startX = firstX;
    let startY = firstY;
    // 算这一段终点要用的下一个原始点就是下一段的控制点：每个原始点只取一次。
    let controlX = xAt(1);
    let controlY = yAt(1);
    for (let index = 1; index < points - 1; index += 1) {
      const nextX = xAt(index + 1);
      const nextY = yAt(index + 1);
      const endX = (controlX + nextX) / 2;
      const endY = (controlY + nextY) / 2;
      if (hidden(startX, endX, Math.min(startY, controlY, endY))) {
        open = false;
        startX = endX;
        startY = endY;
        controlX = nextX;
        controlY = nextY;
        continue;
      }
      begin(startX, startY);
      const parts = partsFor(
        Math.hypot(startX - 2 * controlX + endX, startY - 2 * controlY + endY) / 4,
        tolerance,
      );
      for (let step = 1; step <= parts; step += 1) {
        const t = step / parts;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        push(a * startX + b * controlX + c * endX, a * startY + b * controlY + c * endY);
      }
      startX = endX;
      startY = endY;
      controlX = nextX;
      controlY = nextY;
    }
    if (hidden(startX, lastX, Math.min(startY, lastY))) open = false;
    else {
      begin(startX, startY);
      push(lastX, lastY);
    }
  } else {
    let startX = firstX;
    let startY = firstY;
    for (let index = 1; index < points; index += 1) {
      const x = xAt(index);
      const y = yAt(index);
      if (hidden(startX, x, Math.min(startY, y))) open = false;
      else {
        begin(startX, startY);
        push(x, y);
      }
      startX = x;
      startY = y;
    }
  }
  out.length = length;
  out.runs = runs;
}

export interface Skyline extends Occluder {
  /** x 处的轮廓高度（相邻两列线性插值）；没画过的地方是一个很大的数。 */
  at(x: number): number;
  /** 把折线里高出轮廓的段接进当前路径：可见性翻转处按线性插值切开，`moveTo` / `lineTo` 分段；折线断开处不相连。 */
  strokeVisible(ctx: PathContext, line: Polyline): void;
  /** 把 y 处 `left…right` 的水平线接进路径，只画高出轮廓的列段：长横线不能只看两端，要逐列扫。 */
  strokeLevel(ctx: PathContext, y: number, left: number, right: number): void;
  /** 把折线并进轮廓：逐像素列取更小的 y，断开处不连。折线的 x 须单调递增。 */
  raise(line: Polyline): void;
}

export function createSkyline(width: number): Skyline {
  const columns = Math.max(2, Math.ceil(width) + 2);
  const heights = new Float32Array(columns).fill(OPEN);
  const heightAt = (column: number): number => heights[column] ?? OPEN;
  const columnOf = (x: number): number => Math.max(0, Math.min(columns - 2, Math.floor(x)));
  const at = (x: number): number => {
    const column = columnOf(x);
    const fraction = Math.min(1, Math.max(0, x - column));
    return heightAt(column) * (1 - fraction) + heightAt(column + 1) * fraction;
  };
  const runEnd = (line: Polyline, run: number): number =>
    run + 1 < line.runs ? (line.starts[run + 1] ?? line.length) : line.length;

  function strokeRun(ctx: PathContext, line: Polyline, from: number, to: number): void {
    const x0 = line.x[from] ?? 0;
    const y0 = line.y[from] ?? 0;
    let previous = at(x0) - y0;
    let drawing = previous > 0;
    if (drawing) ctx.moveTo(x0, y0);
    for (let index = from + 1; index < to; index += 1) {
      const x = line.x[index] ?? 0;
      const y = line.y[index] ?? 0;
      const distance = at(x) - y;
      if (distance > 0 !== previous > 0) {
        const t = previous / (previous - distance);
        const prevX = line.x[index - 1] ?? 0;
        const prevY = line.y[index - 1] ?? 0;
        const crossX = prevX + (x - prevX) * t;
        const crossY = prevY + (y - prevY) * t;
        if (drawing) ctx.lineTo(crossX, crossY);
        else ctx.moveTo(crossX, crossY);
        drawing = distance > 0;
      }
      if (drawing) ctx.lineTo(x, y);
      previous = distance;
    }
  }

  function raiseRun(line: Polyline, from: number, to: number): void {
    for (let index = from + 1; index < to; index += 1) {
      const x0 = line.x[index - 1] ?? 0;
      const x1 = line.x[index] ?? 0;
      const y0 = line.y[index - 1] ?? 0;
      const y1 = line.y[index] ?? 0;
      const first = Math.max(0, Math.ceil(x0));
      const last = Math.min(columns - 1, Math.floor(x1));
      for (let column = first; column <= last; column += 1) {
        const t = x1 > x0 ? (column - x0) / (x1 - x0) : 0;
        const y = y0 + (y1 - y0) * t;
        if (y < heightAt(column)) heights[column] = y;
      }
    }
  }

  return {
    at,
    lowestIn(x0, x1) {
      // `at` 读 x 所在列与右邻列，`raise` 写 ceil(x0)…floor(x1)；两边的列都要算进来。
      const last = columnOf(x1 + OCCLUSION_MARGIN) + 1;
      let lowest = -OPEN;
      for (let column = columnOf(x0 - OCCLUSION_MARGIN); column <= last; column += 1) {
        const height = heights[column] ?? OPEN;
        if (height > lowest) lowest = height;
      }
      return lowest;
    },
    strokeVisible(ctx, line) {
      for (let run = 0; run < line.runs; run += 1) {
        strokeRun(ctx, line, line.starts[run] ?? 0, runEnd(line, run));
      }
    },
    strokeLevel(ctx, y, left, right) {
      const first = Math.max(0, Math.ceil(left));
      const last = Math.min(columns - 1, Math.floor(right));
      let runStart = -1;
      for (let column = first; column <= last + 1; column += 1) {
        const visible = column <= last && y < heightAt(column);
        if (visible) {
          if (runStart < 0) runStart = column;
          continue;
        }
        if (runStart >= 0) {
          ctx.moveTo(Math.max(left, runStart), y);
          ctx.lineTo(Math.min(right, column), y);
          runStart = -1;
        }
      }
    },
    raise(line) {
      for (let run = 0; run < line.runs; run += 1) {
        raiseRun(line, line.starts[run] ?? 0, runEnd(line, run));
      }
    },
  };
}
