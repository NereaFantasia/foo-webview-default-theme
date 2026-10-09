import { playbackAtom } from '../../playback/playback.ts';
import type { Store } from '../../kit/store.ts';
import type { BinsFrame } from '../spectrum/spectrumBins.ts';
import { createSpectrumHistory, TERRAIN_ROWS, type SpectrumHistory } from './terrain.ts';
import { shapeTerrainFrame, TERRAIN_RETENTION_PER_60HZ } from './terrainShape.ts';

/**
 * 山脊图自己的历史缓冲：频谱取数每来一帧，经 `terrainShape.ts` 整形后推进这里。与频谱柱那份缓冲分开存：
 * 山脊图的行要整形链的点数与帧间保留量，频谱柱按柱的横轴并柱。两份都只在帧到时写，消费者看版本号。
 *
 * 播放暂停时来帧不推：宿主暂停时照样回静音帧，推进来山脊会一行行滚成平线；不推则版本号不动、画面不重画，
 * 山脊定格在暂停那一刻，恢复播放后从那里接着滚。频谱柱也在暂停时定格（`spectrumHistory.ts` 不收静音帧）。
 */

/**
 * 整形链每行输出的点数。频率轴是幂 2.5，250 Hz 以下（SUB 与 BASS）只占前 18% 的点：256 点时约 47 个，
 * 一点宽的窄峰被 5 点箱形摊平；384 点时约 71 个，1280 宽的近行 3.3 px 一个顶点。
 * 频谱柱那份缓冲按柱数（`SPECTRUM_BARS`）建，不随这里变。
 */
export const TERRAIN_CHAIN_POINTS = 384;
/**
 * 链输出每几点取一个顶点。作参照的 musicvid.org LineBed 屏幕上实际只有 86 个顶点（它的 `update` 按步进 3
 * 写顶点，是个 bug），照它取 3 时直线段的折角在 1280 宽上看得见，所以取 1：链输出的每个点都是顶点、点间走曲线；
 * 棱角靠少平滑而不是少顶点。
 */
export const TERRAIN_DECIMATION = 1;
export const TERRAIN_POINTS = Math.ceil(TERRAIN_CHAIN_POINTS / TERRAIN_DECIMATION);

/** 山脊图的帧来源；`spectrumHistory.ts` 的服务满足它。 */
export interface TerrainSource {
  /** 最新一帧宿主频点；没收过帧是 null。 */
  frame(): BinsFrame | null;
  /** 实测帧距（毫秒），帧间保留量按它折算。 */
  interval(): number;
  /** 每来一帧叫一次 `listener`；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

const FRAME_MS = 1000 / 60;

/** 帧距 `intervalMs` 下上一行的保留量：60 Hz 一帧留 `TERRAIN_RETENTION_PER_60HZ`，帧距越长留得越少。 */
export function terrainRetentionFor(intervalMs: number): number {
  if (!(intervalMs > 0)) return 0;
  return TERRAIN_RETENTION_PER_60HZ ** (intervalMs / FRAME_MS);
}

export interface TerrainHistoryService {
  /** `TERRAIN_ROWS` 行、每行 `TERRAIN_POINTS` 点的环形缓冲。 */
  readonly history: SpectrumHistory;
  /** 推进的行数，每推一行加一。 */
  version(): number;
  /** 推行或清空缓冲时通知；清空不增加版本号。返回退订函数。 */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** 跟着 `source` 的帧推行；播放状态读 `playbackAtom`，在帧到时现读。 */
export function startTerrainHistory(store: Store, source: TerrainSource): TerrainHistoryService {
  const history = createSpectrumHistory(TERRAIN_ROWS, TERRAIN_POINTS);
  history.release();
  let shaped = new Float32Array(0);
  let scratch = new Float32Array(0);
  let row = new Float32Array(0);
  const listeners = new Set<() => void>();
  let version = 0;

  function release(): void {
    history.release();
    shaped = new Float32Array(0);
    scratch = new Float32Array(0);
    row = new Float32Array(0);
    for (const listener of [...listeners]) listener();
  }

  const off = source.subscribe(() => {
    const frame = source.frame();
    if (!frame) {
      release();
      return;
    }
    if (store.get(playbackAtom).state === 'paused') return;
    if (shaped.length === 0) {
      shaped = new Float32Array(TERRAIN_CHAIN_POINTS);
      scratch = new Float32Array(TERRAIN_CHAIN_POINTS);
      row = new Float32Array(TERRAIN_POINTS);
    }
    shapeTerrainFrame(frame, shaped, scratch);
    for (let point = 0; point < TERRAIN_POINTS; point += 1) {
      row[point] = shaped[point * TERRAIN_DECIMATION] ?? 0;
    }
    history.push(row, terrainRetentionFor(source.interval()));
    version += 1;
    for (const listener of [...listeners]) listener();
  });

  return {
    history,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      off();
      release();
      listeners.clear();
    },
  };
}
