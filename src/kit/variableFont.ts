import { useEffect, useState } from 'react';
import { quoteFont } from '../theme/fontStack.ts';

/** 字重的可调范围，CSS 的 `font-weight` 取值 */
export const FONT_WEIGHT_RANGE = { min: 100, max: 900, fallback: 400 } as const;

/** 读出来的字重不在范围内或不是数字时当没指定 */
export function fontWeightOf(raw: unknown): number | null {
  return typeof raw === 'number' &&
    Number.isFinite(raw) &&
    raw >= FONT_WEIGHT_RANGE.min &&
    raw <= FONT_WEIGHT_RANGE.max
    ? Math.round(raw)
    : null;
}

/** 同一个字体始终得到同一个别名；别名只在页面内用，不进偏好 */
export function variableAlias(family: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < family.length; index += 1) {
    hash ^= family.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `theme-vf-${(hash >>> 0).toString(36)}`;
}

const registered = new Set<string>();
let sheet: HTMLStyleElement | null = null;

/**
 * 直接用家族名时，本机字体的字重只按命名实例（细、常规、半粗、粗……）跳变，连可变字体也一样；
 * 经 `@font-face` 的 `local()` 声明一个带字重范围的别名后才能连续调。同一个字体只注册一次
 */
export function registerVariableFont(family: string): string {
  const alias = variableAlias(family);
  if (registered.has(alias) || typeof document === 'undefined') return alias;
  registered.add(alias);
  sheet ??= document.head.appendChild(document.createElement('style'));
  sheet.append(
    `@font-face { font-family: "${alias}"; src: local(${quoteFont(family)}), local(${quoteFont(`${family} Regular`)}); font-weight: ${FONT_WEIGHT_RANGE.min} ${FONT_WEIGHT_RANGE.max}; }\n`,
  );
  return alias;
}

/** 歌词用的字体样式：选了字重就走别名，让字重连续生效；没选字重或没选字体时沿用家族名与继承的字重 */
export function fontStyleOf(
  family: string,
  weight: number | null,
  stack: (family: string) => string,
): { readonly fontFamily: string; readonly fontWeight?: number } {
  if (!family || weight === null) return { fontFamily: stack(family) };
  return { fontFamily: `"${registerVariableFont(family)}", ${stack(family)}`, fontWeight: weight };
}

/** 在给定的 `font-family` 与字重下量一串字的墨量 */
export type MeasureInk = (family: string, weight: number) => number;

function canvasInk(): MeasureInk | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 140;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  return (family, weight) => {
    context.fillStyle = 'white';
    context.fillRect(0, 0, 700, 140);
    context.fillStyle = 'black';
    context.font = `${weight} 90px ${family}`;
    context.fillText('Hamburg', 10, 100);
    const { data } = context.getImageData(0, 0, 700, 140);
    let sum = 0;
    for (let index = 0; index < data.length; index += 4) sum += 255 - (data[index] ?? 255);
    return Math.round(sum / 255);
  };
}

const probes = new Map<string, Promise<boolean>>();

/**
 * 这个本机字体能不能连续调字重：经别名声明后，字重 450 的墨量与 400、500 都不同才算
 * 静态字体三个字重用的是同一个字面，墨量相同。结果按字体缓存；拿不到绘图上下文（`measure` 为 null）时答 false
 */
export function probeVariableWeight(family: string, measure?: MeasureInk | null): Promise<boolean> {
  const cached = probes.get(family);
  if (cached) return cached;
  const result = (async () => {
    const ink = measure === undefined ? canvasInk() : measure;
    if (!ink) return false;
    const alias = registerVariableFont(family);
    const css = `"${alias}", serif`;
    try {
      await document.fonts.load(`90px "${alias}"`);
    } catch {
      return false;
    }
    const [low, middle, high] = [400, 450, 500].map((weight) => ink(css, weight));
    return middle !== low && middle !== high;
  })();
  probes.set(family, result);
  return result;
}

/** 界面上决定要不要出字重一行：选中的是可变字体才出，探测期间与没选字体时都不出 */
export function useVariableWeight(family: string): boolean {
  const [known, setKnown] = useState<{ family: string; variable: boolean } | null>(null);
  useEffect(() => {
    if (!family) return undefined;
    let live = true;
    void probeVariableWeight(family).then((variable) => {
      if (live) setKnown({ family, variable });
    });
    return () => {
      live = false;
    };
  }, [family]);
  return family !== '' && known?.family === family && known.variable;
}
