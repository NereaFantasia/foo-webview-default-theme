import { blueFromArgb, greenFromArgb, Hct, redFromArgb } from '@material/material-color-utilities';
import type { CoverProfile, CoverTone } from '../coverPalette.ts';
import type { ColorScheme } from '../themes.ts';

export type PaletteCorners = readonly number[];

/** 背景使用面积排序；强调色的小色块不能扩大成四分之一的窗口。 */
export function backgroundPalette(
  profile: CoverProfile | null,
  base: CoverTone,
  scheme: ColorScheme,
): PaletteCorners {
  const dominant = profile?.dominant ?? base;
  const mean = profile?.lightness?.mean ?? dominant.tone;
  const dark = scheme === 'dark';
  const center = dark ? 12 + (mean - 50) * 0.03 : 95 + (mean - 50) * 0.012;
  const shade = (color: CoverTone, offset: number) => {
    const tone = Math.max(
      dark ? 8 : 93,
      Math.min(dark ? 16 : 97, center + (color.tone - mean) * 0.025 + offset),
    );
    const argb = Hct.from(color.hue, Math.min(color.chroma, dark ? 36 : 16), tone).toInt();
    return [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)];
  };
  return [0, 1.5, -1, 0.5].flatMap((offset, index) => {
    const ground = shade(dominant, offset);
    const swatch = profile?.palette?.[index];
    if (!swatch || index === 0) return ground;
    const amount = Math.min(1, (swatch.population / Math.max(1, profile?.pixelCount ?? 1)) * 4);
    const color = shade(swatch.color, offset);
    return ground.map((value, channel) => value + (color[channel] - value) * amount);
  });
}

/** 连续双线性场只变形采样坐标；没有封面纹理、独立光斑或逐帧随机数。 */
export function paintBackgroundPalette(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  colors: PaletteCorners,
  phase: number,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1);
      const v = y / Math.max(1, height - 1);
      const s = Math.max(0, Math.min(1, u + Math.sin(v * 4 + phase) * 0.22));
      const t = Math.max(0, Math.min(1, v + Math.sin(u * 3 - phase * 0.7) * 0.22));
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = (colors[channel] ?? 0) * (1 - s) + (colors[3 + channel] ?? 0) * s;
        const bottom = (colors[6 + channel] ?? 0) * (1 - s) + (colors[9 + channel] ?? 0) * s;
        pixels[at + channel] = top * (1 - t) + bottom * t;
      }
      pixels[at + 3] = 255;
    }
  }
}
