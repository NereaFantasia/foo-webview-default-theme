/**
 * CSS 颜色串换成 0…1 的 RGBA 分量，给拿不到 canvas 2D 颜色解析的地方用（WebGL 的 uniform）。
 */
export type Rgba = [number, number, number, number];
const parsed = new Map<string, Rgba>();

/** 十六进制与 rgb 函数写法（带不带透明度都行）直接读；分量 0…1。 */
function parseSimple(css: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(css)?.[1];
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const byte = (at: number): number =>
      at < digits.length ? Number.parseInt(digits.slice(at, at + 2), 16) / 255 : 1;
    return [byte(0), byte(2), byte(4), byte(6)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(
    css,
  );
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
  return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, alpha];
}

/** 别的写法（`oklch()`、`color-mix()` 等）交给 2D canvas 画一个像素再读回来。 */
function parseByCanvas(css: string): Rgba | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
}

/**
 * 线色换成 0…1 的四个分量，透明度与 canvas 2D 一样和 `globalAlpha` 相乘。认不出的写法当黑色，
 * 与 canvas 2D 忽略非法 `strokeStyle`、留在缺省黑色一致。颜色只在主题变时换，结果按字符串缓存。
 */
export function rgbaOf(css: string): Rgba {
  const key = css.trim();
  const known = parsed.get(key);
  if (known) return known;
  const value = parseSimple(key) ?? parseByCanvas(key) ?? [0, 0, 0, 1];
  parsed.set(key, value);
  return value;
}
