import { createFrameScheduler, type FrameClock } from '../frame/frameScheduler.ts';
import { createPaintMeter, type PaintMeter, type PaintStats } from '../perf/paintMeter.ts';
import {
  drawTerrain,
  type SpectrumHistory,
  type TerrainContext,
  type TerrainDrawOptions,
} from './terrain.ts';

/**
 * 山脊图的重画循环。主线程的 canvas 与 Worker 里的 `OffscreenCanvas` 共用这一份，两边画出来一样。
 *
 * 帧与帧之间也画：宿主一帧一帧推，行要是只在帧到时跳一格，山就是一格一格往后蹦的。这里在两帧之间按显示
 * 刷新率重画，行按「距上一帧过了多久 / 帧距」滑向远处；帧停了（超过几个帧距没新帧）就停在滑完的位置，
 * 不再空转。不滑时只在帧到时重画。定格时一帧不画，解除后补画一次。重画请求经 `frameScheduler.ts` 合并。
 */

/** 超过这么久（毫秒，且不少于四个帧距）没有新帧，就当帧停了：画到滑完的位置后不再重画。 */
export const SETTLE_MS = 500;
/**
 * 曲线细分的容差（物理像素）。按它少切的段与恒切 4 份画出来的差不超过 0.1 物理像素，
 * 落在 1 物理像素宽、一到三成透明度的线上看不出来。
 */
export const FLATNESS_DEVICE_PX = 0.05;

export interface TerrainPaintSettings {
  /** 画面尺寸，CSS 像素。 */
  width: number;
  height: number;
  pixelRatio: number;
  /** 线色，不带透明度。 */
  lineColor: string;
  /** 地平线在高度里的位置。 */
  horizonRatio: number;
  alphaNear: number;
  alphaFar: number;
  curve: boolean;
  /** 实测帧距（毫秒），两帧之间的滑动按它算进度。 */
  frameInterval: number;
  /** 两帧之间滑动；减弱动效下关掉，只在帧到时重画。 */
  glide: boolean;
  /**
   * 定格：不再重画，画面停在最后画的那一帧，解除后补画一次。定格期间改尺寸或像素比会清空位图，
   * 也不补画；一开始就定格则一帧都不画。
   */
  frozen: boolean;
}

/** canvas 的物理尺寸；`HTMLCanvasElement` 与 `OffscreenCanvas` 都满足。 */
export interface TerrainSurface {
  width: number;
  height: number;
}

/** 山脊图用哪种画法：整幅在 GPU 上算（`terrainGpu.ts`，WebGL2），或 canvas 2D 上跑 `drawTerrain`。 */
export type TerrainSurfaceKind = 'webgl' | '2d';

export interface TerrainSurfaceContext extends TerrainContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

/** 重画循环只经这一面画山：按尺寸重设 canvas，清屏后画一帧。 */
export interface TerrainDrawer {
  readonly kind: TerrainSurfaceKind;
  /** canvas 的物理尺寸按 CSS 尺寸 × 像素比重设，位图随之清空。 */
  resize(width: number, height: number, pixelRatio: number): void;
  draw(history: SpectrumHistory, options: TerrainDrawOptions): void;
  /** 释放绘制对象；canvas 的最后画面由挂载方按退场或隐藏状态撤销。 */
  dispose?(): void;
}

/** canvas 2D 画法：`drawTerrain` 在调用方线程上跑，光栅方式由调用方取上下文时定。 */
export function canvasDrawer(
  surface: TerrainSurface,
  context: TerrainSurfaceContext,
): TerrainDrawer {
  return {
    kind: '2d',
    resize(width, height, pixelRatio) {
      surface.width = Math.max(1, Math.round(width * pixelRatio));
      surface.height = Math.max(1, Math.round(height * pixelRatio));
      // 改 canvas 尺寸会把上下文状态一并重置，缩放要重设。
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    },
    draw(history, options) {
      drawTerrain(context, history, options);
    },
  };
}

export interface TerrainPainter {
  /** 主线程已确定的上下文种类；Worker 的种类由统计消息回报。 */
  readonly surface?: TerrainSurfaceKind;
  /** 改设置并排一次重画；尺寸或像素比变了，先按物理像素重设 canvas（位图随之清空）。 */
  update(changes: Partial<TerrainPaintSettings>): void;
  /** 缓冲里进了新行：从现在起算滑动进度，排一次重画。 */
  frameArrived(): void;
  /**
   * 给了回调就给每次绘制计时，每个统计窗交一次（`paintMeter.ts`），一并报画法；`null` 停。
   * GPU 画法量到的是提交绘制命令的脚本时间，GPU 上的执行不在其中。
   */
  meter(report: ((stats: PaintStats, surface: TerrainSurfaceKind) => void) | null): void;
  /** 撤掉排着的重画，之后的调用都不再生效。 */
  dispose(): void;
}

/**
 * `history` 每次重画时取：主线程画的是整形链写的那份缓冲，Worker 画的是自己的镜像，镜像重建后换对象。
 * `now` 缺省是 `performance.now()`，`clock` 缺省走 `requestAnimationFrame`；滑动进度与计时只按 `now` 算。
 */
export function createTerrainPainter(
  drawer: TerrainDrawer,
  source: () => SpectrumHistory,
  initial: TerrainPaintSettings,
  now: () => number = () => performance.now(),
  clock?: FrameClock,
): TerrainPainter {
  const settings: TerrainPaintSettings = { ...initial };
  let lastFrameAt: number | null = null;
  let meter: PaintMeter | null = null;
  let disposed = false;
  let history: (() => SpectrumHistory) | null = source;

  const applySize = (): void => drawer.resize(settings.width, settings.height, settings.pixelRatio);

  function paint(): void {
    // GPU 上下文丢了时调用方在 `draw` 里就把画师释放了，这一次别再排下一帧。
    if (disposed || !history || settings.frozen || settings.width === 0 || settings.height === 0)
      return;
    const interval = Math.max(1, settings.frameInterval);
    const elapsed = lastFrameAt === null ? Number.POSITIVE_INFINITY : now() - lastFrameAt;
    const settled = elapsed > Math.max(4 * interval, SETTLE_MS);
    const offset = settings.glide ? (settled ? 1 : Math.min(1, elapsed / interval)) : 0;
    const startedAt = meter ? now() : 0;
    drawer.draw(history(), {
      width: settings.width,
      height: settings.height,
      horizon: settings.height * settings.horizonRatio,
      lineColor: settings.lineColor,
      alphaNear: settings.alphaNear,
      alphaFar: settings.alphaFar,
      pixelRatio: settings.pixelRatio,
      offset,
      curve: settings.curve,
      flatness: FLATNESS_DEVICE_PX / settings.pixelRatio,
    });
    meter?.record(startedAt, now());
    // 还在收帧就接着滑；帧停了这一次画完即止，下一帧到了再起。
    if (!disposed && settings.glide && !settled) frames.schedule();
  }

  const frames = createFrameScheduler(paint, clock);
  if (settings.width > 0 && settings.height > 0) applySize();

  return {
    surface: drawer.kind,
    update(changes) {
      if (disposed) return;
      const resized =
        (changes.width !== undefined && changes.width !== settings.width) ||
        (changes.height !== undefined && changes.height !== settings.height) ||
        (changes.pixelRatio !== undefined && changes.pixelRatio !== settings.pixelRatio);
      Object.assign(settings, changes);
      if (resized) applySize();
      frames.schedule();
    },
    frameArrived() {
      if (disposed) return;
      lastFrameAt = now();
      frames.schedule();
    },
    meter(report) {
      meter = report && !disposed ? createPaintMeter((stats) => report(stats, drawer.kind)) : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      history = null;
      meter = null;
      frames.cancel();
      drawer.dispose?.();
    },
  };
}
