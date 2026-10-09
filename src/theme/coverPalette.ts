import {
  argbFromRgb,
  Hct,
  lstarFromArgb,
  QuantizerCelebi,
  Score,
} from '@material/material-color-utilities';

export interface CoverSeed {
  /** HCT 色相角，度。 */
  hue: number;
  /** HCT 彩度，不是 OKLCH 彩度。 */
  chroma: number;
}

export interface CoverTone extends CoverSeed {
  readonly argb: number;
  readonly tone: number;
}

export interface CoverSwatch {
  readonly color: CoverTone;
  readonly population: number;
}

export interface CoverProfile {
  readonly accent: CoverTone | null;
  readonly dominant: CoverTone | null;
  readonly secondary: readonly CoverTone[];
  readonly gray: boolean;
  readonly pixelCount: number;
  /** 有效原像素的 HCT tone，范围 0 到 100；透明图没有统计。 */
  readonly lightness: { readonly min: number; readonly max: number; readonly mean: number } | null;
  /** 按面积降序保留的颜色；旧版存档没有这一项。 */
  readonly palette?: readonly CoverSwatch[];
}

function isTone(value: unknown): value is CoverTone {
  return (
    typeof value === 'object' &&
    value !== null &&
    'argb' in value &&
    typeof value.argb === 'number' &&
    Number.isInteger(value.argb) &&
    value.argb >= 0xff000000 &&
    value.argb <= 0xffffffff &&
    'hue' in value &&
    typeof value.hue === 'number' &&
    value.hue >= 0 &&
    value.hue <= 360 &&
    'chroma' in value &&
    typeof value.chroma === 'number' &&
    Number.isFinite(value.chroma) &&
    value.chroma >= 0 &&
    'tone' in value &&
    typeof value.tone === 'number' &&
    value.tone >= 0 &&
    value.tone <= 100
  );
}

export function isCoverProfile(value: unknown): value is CoverProfile {
  if (typeof value !== 'object' || value === null) return false;
  if (!('accent' in value) || (value.accent !== null && !isTone(value.accent))) return false;
  if (!('dominant' in value) || (value.dominant !== null && !isTone(value.dominant))) return false;
  if (
    !('secondary' in value) ||
    !Array.isArray(value.secondary) ||
    value.secondary.length > 3 ||
    !value.secondary.every(isTone)
  )
    return false;
  if (!('gray' in value) || typeof value.gray !== 'boolean') return false;
  if (
    !('pixelCount' in value) ||
    typeof value.pixelCount !== 'number' ||
    !Number.isInteger(value.pixelCount) ||
    value.pixelCount < 0 ||
    value.pixelCount > 4096
  )
    return false;
  if (!('lightness' in value)) return false;
  if ('palette' in value) {
    if (!Array.isArray(value.palette) || value.palette.length > 16) return false;
    let population = 0;
    for (const swatch of value.palette) {
      if (
        typeof swatch !== 'object' ||
        swatch === null ||
        !('color' in swatch) ||
        !isTone(swatch.color) ||
        !('population' in swatch) ||
        typeof swatch.population !== 'number' ||
        !Number.isInteger(swatch.population) ||
        swatch.population <= 0
      )
        return false;
      population += swatch.population;
    }
    if (population > value.pixelCount) return false;
  }
  if (value.pixelCount === 0) {
    return (
      value.lightness === null &&
      value.dominant === null &&
      value.accent === null &&
      value.secondary.length === 0 &&
      value.gray
    );
  }
  const stats = value.lightness;
  return (
    value.dominant !== null &&
    typeof stats === 'object' &&
    stats !== null &&
    'min' in stats &&
    typeof stats.min === 'number' &&
    'max' in stats &&
    typeof stats.max === 'number' &&
    'mean' in stats &&
    typeof stats.mean === 'number' &&
    stats.min >= 0 &&
    stats.max <= 100 &&
    stats.mean >= stats.min &&
    stats.mean <= stats.max
  );
}

function toneOf(argb: number): CoverTone {
  const { hue, chroma, tone } = Hct.fromInt(argb);
  return { argb, hue, chroma, tone };
}

function eligible(color: number): boolean {
  const hct = Hct.fromInt(color);
  return hct.chroma >= 8 && hct.tone >= 5;
}

/** RGBA 中 alpha 小于 128 的像素不计入面积；没有可靠强调色时答 null。 */
export function seedFromPixels(data: Uint8ClampedArray): CoverSeed | null {
  const accent = profileFromPixels(data).accent;
  return accent ? { hue: accent.hue, chroma: accent.chroma } : null;
}

/** 无强调色仍保留主色与明度；读取失败由调用方处理，不能表示成灰图。 */
export function profileFromPixels(data: Uint8ClampedArray): CoverProfile {
  const pixels: number[] = [];
  const histogram = new Map<number, number>();
  for (let at = 0; at + 3 < data.length; at += 4) {
    if (data[at + 3] < 128) continue;
    const color = argbFromRgb(data[at], data[at + 1], data[at + 2]);
    pixels.push(color);
    histogram.set(color, (histogram.get(color) ?? 0) + 1);
  }
  if (!pixels.length) {
    return {
      accent: null,
      dominant: null,
      secondary: [],
      gray: true,
      pixelCount: 0,
      lightness: null,
      palette: [],
    };
  }
  let min = 100;
  let max = 0;
  let sum = 0;
  for (const [color, count] of histogram) {
    const tone = lstarFromArgb(color);
    min = Math.min(min, tone);
    max = Math.max(max, tone);
    sum += tone * count;
  }
  const colors = QuantizerCelebi.quantize(pixels, 64);
  const palette = [...colors]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([color, population]) => ({ color: toneOf(color), population }));
  let qualified = 0;
  let gray = true;
  let dominant: CoverTone | null = null;
  let largest = 0;
  for (const [color, count] of colors) {
    const tone = toneOf(color);
    if (tone.chroma >= 8 && tone.tone >= 5) {
      qualified += count;
      gray = false;
    }
    if (count > largest) {
      dominant = tone;
      largest = count;
    }
  }
  // 保留完整面积分布供 Score 排序，不能先过滤直方图再打分。
  const candidates = Score.score(colors, { desired: 4, filter: true, fallbackColorARGB: 0 });
  const accents =
    qualified >= pixels.length * 0.05
      ? candidates.filter((candidate) => candidate !== 0 && eligible(candidate)).map(toneOf)
      : [];
  return {
    accent: accents[0] ?? null,
    dominant,
    secondary: accents.slice(1),
    gray,
    pixelCount: pixels.length,
    lightness: { min, max, mean: Math.max(min, Math.min(max, sum / pixels.length)) },
    palette,
  };
}
