import type { PaintStats } from '../perf/paintMeter.ts';
import type { TerrainThread } from '../perf/perfOverlay.ts';
import type { SpectrumHistory } from './terrain.ts';
import type { TerrainPainter, TerrainPaintSettings, TerrainSurfaceKind } from './terrainPainter.ts';

/**
 * 山脊图的 canvas 挂在哪条路上画：能转离屏 canvas 就交给 Worker（`terrainWorker.ts`），主线程不再按刷新率
 * 跑绘制；不支持、Worker 起不来或运行中出错，就在主线程画。主线程先试 WebGL2（`terrainGpu.ts`），
 * 建不起或上下文丢了退到 canvas 2D。
 *
 * 每退一步都换一块新 canvas：控制权转给 Worker 的 canvas 收不回来，开过 WebGL 的 canvas 要不到 2D 上下文。
 * 两种失败各只退一次，记在这一次挂载里；之后换数据来源重起画师时直接走退好的那条路。
 * 设置在这里留一份最新值，换画师时新画师照它起步，性能小窗的回报也随之重接，带上新的线程。
 */

type FailureCause = 'worker' | 'gpu';

/** 性能小窗要的回报：画在哪条线程、用哪种上下文，与这一个统计窗的计时。 */
export type TerrainReporter = (
  thread: TerrainThread,
  surface: TerrainSurfaceKind,
  stats: PaintStats,
) => void;

/** 换 canvas 与起画师的几样操作；页面里的实现见 `domTerrainBackends.ts`。 */
export interface TerrainBackends {
  /** 移走并释放当前的 canvas（有的话），换上一块没开过上下文、没转过控制权的新 canvas。 */
  replaceCanvas(): void;
  /** 移走并释放当前的 canvas。 */
  releaseCanvas(): void;
  /**
   * 把当前 canvas 的控制权转给新起的 Worker 画。不支持离屏 canvas 或 Worker 建不起时返回 null，
   * canvas 原样没动。Worker 之后出错（脚本载不进、运行中抛异常、它那边的 WebGL 上下文丢了）调 `onError`。
   * `gpu` 为假时不再探测 GPU；初始化后经 `onSurface` 回报实际后端，供恢复时沿用结论。
   */
  startWorker(
    history: () => SpectrumHistory,
    settings: TerrainPaintSettings,
    onError: () => void,
    gpu: boolean,
    onSurface: (surface: TerrainSurfaceKind) => void,
  ): TerrainPainter | null;
  /**
   * 在主线程上画当前 canvas；`gpu` 为真先试 WebGL2，用不了再要 2D。canvas 开了 WebGL2 却建不起渲染器时抛错；
   * 上下文丢了在下一次绘制里调 `onLost`。连 2D 上下文都要不到时返回 null。
   */
  startMain(
    history: () => SpectrumHistory,
    settings: TerrainPaintSettings,
    gpu: boolean,
    onLost: () => void,
  ): TerrainPainter | null;
}

export interface TerrainMount {
  /** 换数据来源；`null` 停画，只有可见退场时才保留最后一帧的 canvas。 */
  setHistory(history: SpectrumHistory | null, retainCanvas?: boolean): void;
  /** 改设置；有画师就转给它，没有也记下，下一个画师照它起步。 */
  update(changes: Partial<TerrainPaintSettings>): void;
  /** 缓冲里进了新行。 */
  frameArrived(): void;
  /** 给了回调就给绘制计时，每个统计窗回报一次；`null` 停。 */
  meter(report: TerrainReporter | null): void;
  /** 停画、移走 canvas；之后的调用都不再生效。 */
  dispose(): void;
}

export function mountTerrain(
  backends: TerrainBackends,
  initial: TerrainPaintSettings,
  failures = { worker: false, gpu: false },
): TerrainMount {
  const settings: TerrainPaintSettings = { ...initial };
  let history: SpectrumHistory | null = null;
  let painter: TerrainPainter | null = null;
  let thread: TerrainThread = 'main';
  let report: TerrainReporter | null = null;
  let disposed = false;
  // 每停一个画师加一：已经换下的画师晚到的出错回调据此丢掉。
  let generation = 0;

  function applyMeter(): void {
    const current = report;
    const where = thread;
    painter?.meter(current ? (stats, surface) => current(where, surface, stats) : null);
  }

  function stop(): void {
    generation += 1;
    const previous = painter;
    painter = null;
    previous?.dispose();
  }

  function start(target: SpectrumHistory): void {
    stop();
    const mine = generation;
    const source = (): SpectrumHistory => target;
    const fail = (cause: FailureCause) => (): void => {
      if (mine === generation) restart(cause);
    };
    backends.replaceCanvas();
    try {
      painter = failures.worker
        ? null
        : backends.startWorker(
            source,
            { ...settings },
            fail('worker'),
            !failures.gpu,
            (surface) => {
              if (mine === generation && surface === '2d') failures.gpu = true;
            },
          );
    } catch {
      restart('worker');
      return;
    }
    thread = painter ? 'worker' : 'main';
    if (!painter) {
      failures.worker = true;
      try {
        painter = backends.startMain(source, { ...settings }, !failures.gpu, fail('gpu'));
        if (!painter || painter.surface === '2d') failures.gpu = true;
      } catch {
        restart('gpu');
        return;
      }
    }
    applyMeter();
    // 新画师建好时不画，等到尺寸变或来帧才画；暂停时两样都不会来，这里先排一次。
    painter?.update({});
  }

  function restart(cause: FailureCause): void {
    if (disposed || !history) return;
    if (failures[cause]) return;
    failures[cause] = true;
    start(history);
  }

  return {
    setHistory(next, retainCanvas = false) {
      if (disposed) return;
      if (next === null) {
        history = null;
        try {
          stop();
        } finally {
          if (!retainCanvas) backends.releaseCanvas();
        }
        return;
      }
      if (next === history) return;
      history = next;
      start(next);
    },
    update(changes) {
      if (disposed) return;
      Object.assign(settings, changes);
      painter?.update(changes);
    },
    frameArrived() {
      if (!disposed) painter?.frameArrived();
    },
    meter(next) {
      if (disposed) return;
      report = next;
      applyMeter();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      history = null;
      report = null;
      try {
        stop();
      } finally {
        backends.releaseCanvas();
      }
    },
  };
}
