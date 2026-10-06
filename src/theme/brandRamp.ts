import type { BrandVariants } from '@fluentui/react-components';
import { argbFromHex, Hct, hexFromArgb, TonalPalette } from '@material/material-color-utilities';
import { tealBrand } from './brand.ts';
import type { CoverSeed } from './coverColor.ts';

const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
const SHAPE = STEPS.map((step) => ({
  step,
  tone: Hct.fromInt(argbFromHex(tealBrand[step])).tone,
}));

/** 保留青绿的明度阶梯；彩度只受 sRGB 色域限制，不主动放大低彩度封面。 */
export function rampFrom(seed: CoverSeed): BrandVariants {
  const palette = TonalPalette.fromHueAndChroma(seed.hue, seed.chroma);
  const ramp: BrandVariants = { ...tealBrand };
  for (const { step, tone } of SHAPE) ramp[step] = hexFromArgb(palette.tone(tone));
  return ramp;
}
