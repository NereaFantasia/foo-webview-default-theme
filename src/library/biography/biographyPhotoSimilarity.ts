import { sameCoverPixels } from '../../covers/sameCoverPixels.ts';

const SAMPLE_SIDE = 32;
const SAMPLE_LENGTH = SAMPLE_SIDE * SAMPLE_SIDE * 4;
const MAX_MEAN_DIFFERENCE = 22;
const MAX_ALIGNED_ERROR = 100;
const SCALE_CHOICES = [0.75, 0.875, 1];
const OFFSET_CHOICES = [-2, 0, 2];

interface Alignment {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

interface Match {
  readonly alignment: Alignment;
  readonly error: number;
}

const IDENTITY: Alignment = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
const COMPARISONS = new WeakMap<ArrayLike<number>, WeakMap<ArrayLike<number>, boolean>>();

function meanDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < SAMPLE_LENGTH; i += 4) {
    if (a[i + 3] !== 255 || b[i + 3] !== 255) return Infinity;
    for (let channel = 0; channel < 3; channel++)
      sum += Math.abs((a[i + channel] ?? 0) - (b[i + channel] ?? 0));
  }
  return sum / (SAMPLE_SIDE * SAMPLE_SIDE * 3);
}

function sample(pixels: ArrayLike<number>, x: number, y: number, channel: number): number {
  const column = Math.floor(x);
  const row = Math.floor(y);
  const dx = x - column;
  const dy = y - row;
  const start = (row * SAMPLE_SIDE + column) * 4 + channel;
  return (
    (pixels[start] ?? 0) * (1 - dx) * (1 - dy) +
    (pixels[start + 4] ?? 0) * dx * (1 - dy) +
    (pixels[start + SAMPLE_SIDE * 4] ?? 0) * (1 - dx) * dy +
    (pixels[start + SAMPLE_SIDE * 4 + 4] ?? 0) * dx * dy
  );
}

/** 对齐后比较 RGB 均方差；保留中间 28×28 的完整区域，不让局部小块相似代表整张照片 */
function difference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  alignment: Alignment,
  step: number,
): number {
  let sum = 0;
  let count = 0;
  const center = (SAMPLE_SIDE - 1) / 2;
  for (let y = 2; y < SAMPLE_SIDE - 2; y += step) {
    const fromY = (y - center) * alignment.scaleY + center + alignment.offsetY;
    if (fromY < 0 || fromY >= SAMPLE_SIDE - 1) return Infinity;
    for (let x = 2; x < SAMPLE_SIDE - 2; x += step) {
      const fromX = (x - center) * alignment.scaleX + center + alignment.offsetX;
      if (fromX < 0 || fromX >= SAMPLE_SIDE - 1) return Infinity;
      for (let channel = 0; channel < 3; channel++) {
        const delta =
          sample(a, fromX, fromY, channel) - (b[(y * SAMPLE_SIDE + x) * 4 + channel] ?? 0);
        sum += delta * delta;
        count += 1;
      }
    }
  }
  return sum / count;
}

function croppedMatch(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  const original = difference(a, b, IDENTITY, 1);
  let best: Match = { alignment: IDENTITY, error: difference(a, b, IDENTITY, 3) };
  const consider = (alignment: Alignment) => {
    const error = difference(a, b, alignment, 3);
    if (error < best.error) best = { alignment, error };
  };
  for (const scaleX of SCALE_CHOICES)
    for (const scaleY of SCALE_CHOICES)
      for (const offsetX of OFFSET_CHOICES)
        for (const offsetY of OFFSET_CHOICES) consider({ scaleX, scaleY, offsetX, offsetY });

  // 先找裁切范围，再逐轴细调；只允许小幅缩放与平移，不旋转或改变图像颜色
  for (const [scaleStep, offsetStep] of [
    [0.025, 0.5],
    [0.005, 0.125],
  ] as const) {
    for (let pass = 0; pass < 2; pass++) {
      for (const axis of ['scaleX', 'scaleY', 'offsetX', 'offsetY'] as const) {
        const origin = best.alignment;
        const scale = axis === 'scaleX' || axis === 'scaleY';
        const step = scale ? scaleStep : offsetStep;
        for (let shift = -3; shift <= 3; shift++) {
          const value = origin[axis] + shift * step;
          if (scale ? value < 0.7 || value > 1.05 : Math.abs(value) > 3) continue;
          consider({ ...origin, [axis]: value });
        }
      }
    }
  }
  const aligned = difference(a, b, best.alignment, 1);
  return aligned <= MAX_ALIGNED_ERROR && aligned <= original / 4;
}

/** 照片允许轻微裁切；采样像素在解码后不再修改，比较结果随像素对象一起回收 */
export function sameBiographyPhotoPixels(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  const cached = COMPARISONS.get(a)?.get(b);
  if (cached !== undefined) return cached;
  const same =
    sameCoverPixels(a, b) ||
    (a.length === SAMPLE_LENGTH &&
      b.length === SAMPLE_LENGTH &&
      meanDifference(a, b) <= MAX_MEAN_DIFFERENCE &&
      (croppedMatch(a, b) || croppedMatch(b, a)));
  const matches = COMPARISONS.get(a) ?? new WeakMap<ArrayLike<number>, boolean>();
  matches.set(b, same);
  COMPARISONS.set(a, matches);
  const reverse = COMPARISONS.get(b) ?? new WeakMap<ArrayLike<number>, boolean>();
  reverse.set(a, same);
  COMPARISONS.set(b, reverse);
  return same;
}
