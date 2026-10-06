import { cellKey, type Decor } from './paperDecor.ts';
/**
 * 按 `buildDecor` 的布局画生成式网格。先清屏，自下而上是径向微光、仪表弧、格线、填色格与对角线、
 * 散点记号；各件的颜色与透明度照 catbot-3 网页版，格线颜色取 `--paper-grid`。
 * 纯函数，canvas 2D 上下文由调用方注入，只经 `DecorContext` 这一面画。
 */

export interface DecorStyle {
  /** 格线色：自带透明度的 token，原样用。 */
  grid: string;
  /**
   * 数据墨、热色、中性墨：不带透明度，各件的透明度走 `globalAlpha`。要六位十六进制，即 `fillStyle` 规整
   * 不透明色的写法；别的写法下，微光的透明端退回透明黑。
   */
  ink: string;
  hot: string;
  neutral: string;
  /** 箭头字符的等宽字体栈。 */
  mono: string;
}

/** 画装饰用到的 canvas 2D 面；`CanvasRenderingContext2D` 满足它。 */
export interface DecorContext {
  globalAlpha: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
}

/** 以下长度都是网页版像素，作画时乘 `decor.unit`：刻度线在弧内外各伸出的长度、`>>` 记号的字号。 */
const TICK_REACH = 14;
const CHEVRON_FONT_PX = 13;
/** 径向微光：内圆偏左上一点、半径 80，外圆半径 1040（网页版数），58% 处淡到全透明。 */
const GLOW_SHIFT = 20;
const GLOW_INNER = 80;
const GLOW_OUTER = 1040;
const GLOW_FADE_AT = 0.58;

/**
 * 同一颜色的全透明版。canvas 渐变按未预乘的 RGBA 插值，两端若是「某色」与「透明黑」，中段会发灰，
 * 所以透明端要取同色：六位十六进制补上 `00` 透明度。别的写法退回透明黑。
 */
export function transparentOf(color: string): string {
  const trimmed = color.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? `${trimmed}00` : 'transparent';
}

/** 1 px 线压在像素中间才不发虚：坐标取整再挪半个像素。 */
const crisp = (value: number): number => Math.floor(value) + 0.5;

function drawGlow(ctx: DecorContext, decor: Decor, style: DecorStyle): void {
  const { x: cx, y: cy } = decor.center;
  const u = decor.unit;
  const gradient = () =>
    ctx.createRadialGradient(
      cx - GLOW_SHIFT * u,
      cy - GLOW_SHIFT * u,
      GLOW_INNER * u,
      cx,
      cy,
      GLOW_OUTER * u,
    );
  const center = gradient();
  center.addColorStop(0, style.hot);
  center.addColorStop(GLOW_FADE_AT, transparentOf(style.hot));
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = center;
  ctx.fillRect(0, 0, decor.width, decor.height);
  const edge = gradient();
  edge.addColorStop(GLOW_FADE_AT, transparentOf(style.ink));
  edge.addColorStop(1, style.ink);
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, decor.width, decor.height);
}

function drawArcs(ctx: DecorContext, decor: Decor, style: DecorStyle): void {
  ctx.lineWidth = 1;
  const reach = TICK_REACH * decor.unit;
  for (const arc of decor.arcs) {
    ctx.globalAlpha = 0.045;
    ctx.strokeStyle = style.ink;
    ctx.beginPath();
    ctx.arc(arc.cx, arc.cy, arc.r, arc.from, arc.to);
    ctx.stroke();
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = style.neutral;
    ctx.beginPath();
    for (let index = 0; index < arc.ticks; index += 1) {
      const t = arc.ticks <= 1 ? 0 : index / (arc.ticks - 1);
      const angle = arc.from + (arc.to - arc.from) * t;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(arc.cx + cos * (arc.r - reach), arc.cy + sin * (arc.r - reach));
      ctx.lineTo(arc.cx + cos * (arc.r + reach), arc.cy + sin * (arc.r + reach));
    }
    ctx.stroke();
  }
}

/** 格线按段画：两格之间的那一段，两边任一格打开就不画，打开的格因此四条边都没有。 */
function drawGrid(ctx: DecorContext, decor: Decor, style: DecorStyle): void {
  const { origin, columns, rows, open, cell } = decor;
  const isOpen = (column: number, row: number): boolean => open.has(cellKey(column, row));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = style.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let column = columns[0]; column <= columns[1] + 1; column += 1) {
    const x = crisp(origin.x + column * cell);
    for (let row = rows[0]; row <= rows[1]; row += 1) {
      if (isOpen(column - 1, row) || isOpen(column, row)) continue;
      const y = origin.y + row * cell;
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + cell);
    }
  }
  for (let row = rows[0]; row <= rows[1] + 1; row += 1) {
    const y = crisp(origin.y + row * cell);
    for (let column = columns[0]; column <= columns[1]; column += 1) {
      if (isOpen(column, row - 1) || isOpen(column, row)) continue;
      const x = origin.x + column * cell;
      ctx.moveTo(x, y);
      ctx.lineTo(x + cell, y);
    }
  }
  ctx.stroke();
}

function drawCells(ctx: DecorContext, decor: Decor, style: DecorStyle): void {
  const { cell } = decor;
  const cornerOf = (key: string): [number, number] => {
    const [column = 0, row = 0] = key.split(',').map(Number);
    return [decor.origin.x + column * cell, decor.origin.y + row * cell];
  };
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = style.ink;
  for (const key of decor.filled) {
    const [x, y] = cornerOf(key);
    ctx.fillRect(x, y, cell, cell);
  }
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = style.neutral;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const [key, slash] of decor.diagonals) {
    const [x, y] = cornerOf(key);
    ctx.moveTo(x, slash ? y + cell : y);
    ctx.lineTo(x + cell, slash ? y : y + cell);
  }
  ctx.stroke();
}

function drawMarks(ctx: DecorContext, decor: Decor, style: DecorStyle): void {
  ctx.font = `${Math.round(CHEVRON_FONT_PX * decor.unit)}px ${style.mono}`;
  ctx.lineWidth = 1.2;
  for (const { kind, x, y, size, horizontal, text } of decor.marks) {
    if (kind === 'dot') {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = style.neutral;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'square') {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = style.ink;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    } else if (kind === 'chevron') {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = style.hot;
      ctx.fillText(text, x, y);
    } else {
      ctx.globalAlpha = kind === 'plus' ? 0.22 : 0.2;
      ctx.strokeStyle = style.neutral;
      ctx.beginPath();
      if (kind === 'plus') {
        ctx.moveTo(x - size, y);
        ctx.lineTo(x + size, y);
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y + size);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(horizontal ? x + size : x, horizontal ? y : y + size);
      }
      ctx.stroke();
    }
  }
}

export function drawDecor(ctx: DecorContext, decor: Decor, style: DecorStyle): void {
  ctx.clearRect(0, 0, decor.width, decor.height);
  drawGlow(ctx, decor, style);
  drawArcs(ctx, decor, style);
  drawGrid(ctx, decor, style);
  drawCells(ctx, decor, style);
  drawMarks(ctx, decor, style);
  ctx.globalAlpha = 1;
}
