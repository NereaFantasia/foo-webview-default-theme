import { COLUMN_PITCH, COLUMN_WIDTH, columnLevels, playedColumnCount } from './waveformColumns.ts';
import type { LayerTone, WaveformLayer } from './waveformModes.ts';

/**
 * 整轨波形各层的画法：层先按 canvas 宽重采样成列（数据或尺寸变时算一次），每次重画只按播放头染色。
 * 没有分道的层以中线上下对称，有分道的在自己那一道里从底往上；有声的列至少画 1 px，安静段不至于断成缺口。
 */

/** 画层只用到 canvas 2D 上下文的这三项，`CanvasRenderingContext2D` 直接满足。 */
export interface WaveformContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export interface WaveformPalette {
  ink: string;
  hot: string;
  idle: string;
}

export interface ColumnLayer {
  levels: Float32Array;
  tone: LayerTone;
  lane?: number;
  /** 整层的透明度倍数，缺省 1；换数据时形变中的层才小于 1（`waveformMorph.ts`）。 */
  alpha?: number;
}

/** 分道之间的空（CSS 像素）。 */
export const LANE_GAP = 3;

/**
 * 已播段按色调取色；未播段一律取未播色，三种色调换成三档深浅，叠画与分道在灰里也分得开。
 * 淡色取数据墨的三成五：底影与主体分得开，又不抢主体。
 */
const TONES: Record<LayerTone, { color: 'ink' | 'hot'; playedAlpha: number; idleAlpha: number }> = {
  shade: { color: 'ink', playedAlpha: 0.35, idleAlpha: 0.4 },
  ink: { color: 'ink', playedAlpha: 1, idleAlpha: 0.75 },
  hot: { color: 'hot', playedAlpha: 1, idleAlpha: 1 },
};

function laneHeightOf(lanes: number, height: number): number {
  return lanes > 0 ? (height - LANE_GAP * (lanes - 1)) / lanes : height;
}

/** 第 `lane` 道（从上往下数）的竖向中点，相对波形带顶；分道名按它对齐。 */
export function laneCenter(lane: number, lanes: number, height: number): number {
  const laneHeight = laneHeightOf(lanes, height);
  return lane * (laneHeight + LANE_GAP) + laneHeight / 2;
}

export function layerColumns(layers: readonly WaveformLayer[], columns: number): ColumnLayer[] {
  return layers.map((layer) => ({
    levels: columnLevels(layer.points, columns),
    tone: layer.tone,
    ...(layer.lane === undefined ? {} : { lane: layer.lane }),
  }));
}

/** 从后往前画各层；`playedX` 左边算已播。 */
export function drawColumnLayers(
  ctx: WaveformContext,
  layers: readonly ColumnLayer[],
  height: number,
  palette: WaveformPalette,
  playedX: number,
): void {
  const lanes = layers.reduce(
    (count, layer) => (layer.lane === undefined ? count : Math.max(count, layer.lane + 1)),
    0,
  );
  const laneHeight = laneHeightOf(lanes, height);
  const middle = height / 2;
  const playedColumns = playedColumnCount(playedX);
  for (const layer of layers) {
    const tone = TONES[layer.tone];
    const alpha = layer.alpha ?? 1;
    if (alpha <= 0) continue;
    for (let column = 0; column < layer.levels.length; column += 1) {
      const level = layer.levels[column] ?? 0;
      if (level <= 0) continue;
      const x = column * COLUMN_PITCH;
      const played = column < playedColumns;
      ctx.fillStyle = played ? palette[tone.color] : palette.idle;
      ctx.globalAlpha = (played ? tone.playedAlpha : tone.idleAlpha) * alpha;
      if (layer.lane === undefined) {
        const half = Math.max(0.5, level * middle);
        ctx.fillRect(x, middle - half, COLUMN_WIDTH, half * 2);
      } else {
        const bottom = layer.lane * (laneHeight + LANE_GAP) + laneHeight;
        const bar = Math.max(1, level * laneHeight);
        ctx.fillRect(x, bottom - bar, COLUMN_WIDTH, bar);
      }
    }
  }
  ctx.globalAlpha = 1;
}
