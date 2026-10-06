import { paintFpsCap } from '../frame/frameScheduler.ts';
import { isPaintStats, type PaintStats } from '../perf/paintMeter.ts';
import { createSpectrumHistory, type SpectrumHistory } from './terrain.ts';
import type { TerrainPainter, TerrainPaintSettings, TerrainSurfaceKind } from './terrainPainter.ts';

/**
 * 山脊图 Worker 的主线程一端与消息约定：canvas 的控制权转给 Worker，重画循环与 `drawTerrain` 都在那边跑，
 * 主线程每来一帧至多发一条行消息（重画上限变了先另发一条），按刷新率重画的那部分开销不再占主线程。
 *
 * 缓冲仍由主线程的整形链写，Worker 里存一份镜像：每来一帧，把镜像还没有的行按从旧到新发过去，
 * 那边逐行原样推进（主线程写入时已经混过帧间保留量，镜像不再混）。缓冲换了对象就整份重发。
 * 重画上限是各线程各自一份的模块状态，主线程的上限变了随下一条消息带过去。
 * 绘制计时由主线程开关（`meter`），开着时 Worker 每个统计窗回一条 `paintStats`，带上它画山脊图用的上下文种类。
 */

/** `Canvas` 是随 `init` 转移过去的对象；接 `terrainWorker.ts` 时必须是 `OffscreenCanvas`，泛型只为让端口能换实现。 */
export type TerrainWorkerMessage<Canvas = OffscreenCanvas> =
  | { type: 'init'; canvas: Canvas; settings: TerrainPaintSettings }
  | {
      type: 'rows';
      rows: number;
      bands: number;
      /** 按从旧到新排的若干行，每行 `bands` 个值。 */
      data: Float32Array;
      /** 镜像先按 `rows × bands` 重建再推。 */
      reset: boolean;
      /** 这批里有新到的帧：从收到起算滑动进度。挂载时补发的存量行不算。 */
      arrived: boolean;
    }
  | { type: 'update'; settings: Partial<TerrainPaintSettings> }
  | { type: 'paintCap'; fps: number | null }
  | { type: 'meter'; on: boolean };

export type TerrainRowsMessage = Extract<TerrainWorkerMessage, { type: 'rows' }>;

/** Worker 发回主线程的消息。 */
export interface TerrainWorkerReply {
  type: 'paintStats';
  stats: PaintStats;
  /** Worker 里画山脊图的上下文是哪一种。 */
  surface: TerrainSurfaceKind;
}

const MESSAGE_TYPES: ReadonlySet<unknown> = new Set([
  'init',
  'rows',
  'update',
  'paintCap',
  'meter',
]);

/** Worker 收到的消息只来自本模块，只核对判别字段。 */
export function isTerrainWorkerMessage(value: unknown): value is TerrainWorkerMessage {
  return (
    typeof value === 'object' && value !== null && MESSAGE_TYPES.has(Reflect.get(value, 'type'))
  );
}

const SURFACE_KINDS: ReadonlySet<unknown> = new Set<TerrainSurfaceKind>(['webgl', '2d']);

/** 主线程一端：Worker 发回的消息要核对到字段，统计会原样显示在性能小窗上。 */
export function isTerrainWorkerReply(value: unknown): value is TerrainWorkerReply {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'type') === 'paintStats' &&
    isPaintStats(Reflect.get(value, 'stats')) &&
    SURFACE_KINDS.has(Reflect.get(value, 'surface'))
  );
}

/** Worker 一端：把一批行推进镜像。要重建时返回新缓冲，否则返回原缓冲。 */
export function mirrorRows(mirror: SpectrumHistory, message: TerrainRowsMessage): SpectrumHistory {
  const rebuild = message.reset || mirror.rows !== message.rows || mirror.bands !== message.bands;
  const target = rebuild ? createSpectrumHistory(message.rows, message.bands) : mirror;
  for (let start = 0; start < message.data.length; start += message.bands) {
    target.push(message.data.subarray(start, start + message.bands));
  }
  return target;
}

/** `Worker` 用到的那一面。 */
export interface TerrainWorkerPort<Canvas = OffscreenCanvas> {
  postMessage(message: TerrainWorkerMessage<Canvas>, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  terminate(): void;
}

export function createWorkerTerrainPainter<Canvas extends Transferable = OffscreenCanvas>(
  port: TerrainWorkerPort<Canvas>,
  canvas: Canvas,
  history: () => SpectrumHistory,
  initial: TerrainPaintSettings,
): TerrainPainter {
  let mirrored: SpectrumHistory | null = null;
  let mirroredCount = 0;
  let cap: number | null = null;
  let report: ((stats: PaintStats, surface: TerrainSurfaceKind) => void) | null = null;
  let disposed = false;

  function syncCap(): void {
    const current = paintFpsCap();
    if (current === cap) return;
    cap = current;
    port.postMessage({ type: 'paintCap', fps: current }, []);
  }

  function syncRows(arrived: boolean): void {
    const source = history();
    const reset = source !== mirrored;
    const fresh = Math.max(0, Math.min(source.rows, source.count - (reset ? 0 : mirroredCount)));
    mirrored = source;
    mirroredCount = source.count;
    if (!reset && fresh === 0) return;
    const { bands } = source;
    const data = new Float32Array(fresh * bands);
    for (let index = 0; index < fresh; index += 1) {
      data.set(source.row(fresh - 1 - index), index * bands);
    }
    port.postMessage(
      { type: 'rows', rows: source.rows, bands, data, reset, arrived: arrived && fresh > 0 },
      [data.buffer],
    );
  }

  port.addEventListener('message', (event) => {
    const reply = event.data;
    if (!disposed && isTerrainWorkerReply(reply)) report?.(reply.stats, reply.surface);
  });
  port.postMessage({ type: 'init', canvas, settings: { ...initial } }, [canvas]);
  syncCap();
  syncRows(false);

  return {
    update(changes) {
      if (disposed) return;
      syncCap();
      port.postMessage({ type: 'update', settings: changes }, []);
    },
    frameArrived() {
      if (disposed) return;
      syncCap();
      syncRows(true);
    },
    meter(next) {
      if (disposed) return;
      const toggled = (report === null) !== (next === null);
      report = next;
      if (toggled) port.postMessage({ type: 'meter', on: next !== null }, []);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      port.terminate();
    },
  };
}
