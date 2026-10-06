import { blueFromArgb, greenFromArgb, Hct, redFromArgb } from '@material/material-color-utilities';
import type { CoverProfile, CoverTone } from '../coverPalette.ts';

export type PaletteCorners = readonly number[];

export function backgroundPalette(profile: CoverProfile | null, base: CoverTone): PaletteCorners {
  const dominant = profile?.dominant ?? base;
  const colors = [
    dominant.argb,
    profile?.secondary[0]?.argb ??
      Hct.from(dominant.hue, dominant.chroma, Math.min(95, dominant.tone + 16)).toInt(),
    profile?.secondary[1]?.argb ?? profile?.accent?.argb ?? dominant.argb,
    profile?.secondary[2]?.argb ??
      Hct.from(dominant.hue, dominant.chroma, Math.max(8, dominant.tone - 16)).toInt(),
  ];
  return colors.flatMap((argb) => [redFromArgb(argb), greenFromArgb(argb), blueFromArgb(argb)]);
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
