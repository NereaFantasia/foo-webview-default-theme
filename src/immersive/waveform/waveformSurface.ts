import { columnCount } from './waveformColumns.ts';
import {
  drawColumnLayers,
  layerColumns,
  type ColumnLayer,
  type WaveformContext,
  type WaveformPalette,
} from './waveformDraw.ts';
import type { WaveformLayer } from './waveformModes.ts';

/**
 * 整轨波形 canvas 的绘制状态与画一帧：CSS 尺寸、按像素比开的上下文、现读的配色。canvas 读不到 CSS 变量，
 * 配色由调用方在挂载、换主题、换尺寸时现读交进来；尺寸变了才按新宽重排列，只换像素比时列不动。
 */

/** 画一帧用到的上下文，`CanvasRenderingContext2D` 直接满足。 */
export type SurfaceContext = WaveformContext &
  Pick<CanvasRenderingContext2D, 'clearRect' | 'setTransform'>;

/** 开上下文用到的 canvas 那几项，`HTMLCanvasElement` 直接满足。 */
export interface SurfaceCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): SurfaceContext | null;
}

export interface WaveformSurface {
  ctx: SurfaceContext | null;
  /** CSS 像素；还没量到时是 0。 */
  width: number;
  height: number;
  palette: WaveformPalette;
}

export function createSurface(): WaveformSurface {
  return { ctx: null, width: 0, height: 0, palette: { ink: '', hot: '', idle: '' } };
}

/**
 * 按 CSS 尺寸 × `ratio` 开物理像素，至少 1 × 1；改了宽高上下文的变换会复位，重设一次。
 * 答 CSS 尺寸变没变：没变（只换了像素比）时列不用重排。
 */
export function openSurface(
  surface: WaveformSurface,
  canvas: SurfaceCanvas,
  width: number,
  height: number,
  ratio: number,
): boolean {
  const resized = width !== surface.width || height !== surface.height;
  surface.width = width;
  surface.height = height;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  surface.ctx = canvas.getContext('2d');
  surface.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return resized;
}

/** 条色取场景的纸面变量：数据墨、热色与未播段的色。 */
export function readPalette(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): WaveformPalette {
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    ink: read('--paper-ink'),
    hot: read('--paper-hot'),
    idle: read('--paper-waveform-idle'),
  };
}

/** 这组数据按 `width`（CSS 像素）排成的列；数据还没到（`null`）时没有列。 */
export function columnsFor(layers: readonly WaveformLayer[] | null, width: number): ColumnLayer[] {
  return layers ? layerColumns(layers, columnCount(width)) : [];
}

/**
 * 清空重画：`midline` 为真时先画一条 1 px 的未播色中线（新数据还没到），再从后往前画各层，
 * `playedX`（CSS 像素）左边算已播。还没开上下文或尺寸为 0 时不画。
 */
export function paintSurface(
  surface: WaveformSurface,
  layers: readonly ColumnLayer[],
  playedX: number,
  midline: boolean,
): void {
  const { ctx, width, height, palette } = surface;
  if (!ctx || width === 0 || height === 0) return;
  ctx.clearRect(0, 0, width, height);
  if (midline) {
    ctx.fillStyle = palette.idle;
    ctx.fillRect(0, Math.floor(height / 2), width, 1);
  }
  drawColumnLayers(ctx, layers, height, palette, playedX);
}
