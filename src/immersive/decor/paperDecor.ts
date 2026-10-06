import { DIAL_CENTER, SHEET_HEIGHT, SHEET_WIDTH } from '../paper/paperLayout.ts';

/**
 * 仪表图纸的生成式网格布局，做法照 catbot-3 网页版的面板背景：
 * 64 px 格子里一部分格打开（四条边都不画），零星的填色格与对角线，少量散点记号，三段带刻度的仪表弧。
 * 同一种子、同一尺寸、同一护区得到同一张图；作画在 `paperDecorDraw.ts`。
 *
 * 坐标是 CSS 像素、以容器左上为原点；格线对齐版心原点 `origin`，容器比版心小时它是负数。护区按版心坐标给，
 * 护区里不打开格、不填色、不画对角线，记号也避开；格线照画。
 *
 * 两个换算：`scale` 是版心坐标到容器像素的比（版心档 1，full 档是舞台的缩放），格子、护区与弧都乘它；
 * `unit` 是网页版一个像素在容器里多长，记号尺寸、净空、密度与弧上刻度的长短按它算（版心档是 `DECOR_SCALE`）。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DECOR_CELL = 64;
export const DECOR_OPEN_RATIO = 0.18;
export const DECOR_FILL_RATIO = 0.025;
export const DECOR_DIAGONAL_RATIO = 0.035;
/** 版心与网页版页面的长度比（网页版按 1920 宽排）：记号尺寸、净空与密度都按它换算。 */
export const DECOR_SCALE = SHEET_WIDTH / 1920;
/** 网页版 1920 × 1080 的一屏放 10 个记号；按 `unit` 换算成容器像素后，容器更大就多放。 */
const MARKS_PER_CANVAS = 10;
/** 记号中心到护区的最小净空，网页版像素。 */
const MARK_CLEARANCE = 18;
/** 随机落点试这么多次仍在护区里就不放这个记号。 */
const MARK_ATTEMPTS = 30;
/** 点出现的机会是别的两倍，与网页版相同。 */
const MARK_KINDS = ['dot', 'dot', 'square', 'plus', 'tick', 'chevron'] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export interface DecorMark {
  kind: MarkKind;
  x: number;
  y: number;
  /** 点是半径，方块是边长，加号是半臂长，刻线是全长。 */
  size: number;
  /** 刻线横着还是竖着。 */
  horizontal: boolean;
  text: '>>' | '<<';
}

export interface DecorArc {
  cx: number;
  cy: number;
  r: number;
  /** 起止角，弧度，从 x 轴顺时针量。 */
  from: number;
  to: number;
  ticks: number;
}

export interface Decor {
  width: number;
  height: number;
  origin: { x: number; y: number };
  /** 格子边长与网页版一个像素的长度，都是容器像素。 */
  cell: number;
  unit: number;
  /** 版心中心，径向微光围着它。 */
  center: { x: number; y: number };
  /** 铺满容器所需的列、行下标（相对版心原点，含两端）。 */
  columns: readonly [number, number];
  rows: readonly [number, number];
  open: ReadonlySet<string>;
  filled: ReadonlySet<string>;
  /** 画对角线的格；值为真画「/」，为假画「\」。 */
  diagonals: ReadonlyMap<string, boolean>;
  marks: readonly DecorMark[];
  arcs: readonly DecorArc[];
}

/**
 * 1280 × 800 版心上的三段仪表弧（版心坐标）：绕罗盘、圆心在右栏右缘内侧、绕版心中心；起止角照网页版，
 * 半径按本版心另定。别的档位由 `paperTiers.ts` 按它挪位、缩放。
 */
export const SHEET_ARCS: readonly DecorArc[] = [
  { cx: DIAL_CENTER.x, cy: DIAL_CENTER.y, r: 344, from: -2.95, to: 0.58, ticks: 11 },
  { cx: 1131, cy: 423, r: 292, from: 2.9, to: 5.05, ticks: 8 },
  { cx: SHEET_WIDTH / 2, cy: SHEET_HEIGHT / 2, r: 573, from: 3.52, to: 4.42, ticks: 5 },
];

export const cellKey = (column: number, row: number): string => `${column},${row}`;

/** 带种子的伪随机数（mulberry32），取值 [0, 1)。 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 曲目键折成种子（FNV-1a 32 位）；没有曲目时是空串，得 0。 */
export function seedFromKey(key: string): number {
  let hash = 0x811c9dc5;
  if (!key) return 0;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

interface Cell {
  key: string;
  centerX: number;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other] as T, items[index] as T];
  }
  return items;
}

/** 抽出 `ratio` 比例的格，左右两半各占一半；一边不够时从剩下的里补齐。 */
function sampleBalanced(
  cells: readonly Cell[],
  ratio: number,
  middle: number,
  random: () => number,
): Set<string> {
  const left = shuffle(
    cells.filter((cell) => cell.centerX < middle),
    random,
  );
  const right = shuffle(
    cells.filter((cell) => cell.centerX >= middle),
    random,
  );
  const total = Math.round(cells.length * ratio);
  const leftCount = Math.min(left.length, Math.floor(total / 2));
  const rightCount = Math.min(right.length, total - leftCount);
  const picked = [...left.slice(0, leftCount), ...right.slice(0, rightCount)];
  const rest = shuffle([...left.slice(leftCount), ...right.slice(rightCount)], random);
  picked.push(...rest.slice(0, total - picked.length));
  return new Set(picked.map((cell) => cell.key));
}

function markOf(x: number, y: number, unit: number, random: () => number): DecorMark {
  const kind = MARK_KINDS[Math.floor(random() * MARK_KINDS.length)] ?? 'dot';
  const size =
    kind === 'dot'
      ? 1 + random() * 1.6
      : kind === 'square'
        ? 5 + Math.floor(random() * 4)
        : 6 + random() * 8;
  return {
    kind,
    x,
    y,
    size: size * unit,
    horizontal: random() < 0.5,
    text: random() < 0.5 ? '>>' : '<<',
  };
}

/** 版心、原点与弧缺省时按 1280 × 800 版心居中算。 */
export function buildDecor(options: {
  width: number;
  height: number;
  guards: readonly Rect[];
  seed: number;
  sheet?: { width: number; height: number };
  origin?: { x: number; y: number };
  arcs?: readonly DecorArc[];
  scale?: number;
  unit?: number;
}): Decor {
  const { width, height } = options;
  const random = createRandom(options.seed);
  const scale = options.scale ?? 1;
  const unit = options.unit ?? DECOR_SCALE;
  const cell = DECOR_CELL * scale;
  const sheet = options.sheet ?? { width: SHEET_WIDTH, height: SHEET_HEIGHT };
  const origin = options.origin ?? {
    x: (width - sheet.width * scale) / 2,
    y: (height - sheet.height * scale) / 2,
  };
  const center = {
    x: origin.x + (sheet.width * scale) / 2,
    y: origin.y + (sheet.height * scale) / 2,
  };
  const guards = options.guards.map((guard) => ({
    x: origin.x + guard.x * scale,
    y: origin.y + guard.y * scale,
    w: guard.w * scale,
    h: guard.h * scale,
  }));
  const guarded = (rect: Rect): boolean => guards.some((guard) => rectsOverlap(rect, guard));
  const columns = [Math.floor(-origin.x / cell), Math.ceil((width - origin.x) / cell) - 1] as const;
  const rows = [Math.floor(-origin.y / cell), Math.ceil((height - origin.y) / cell) - 1] as const;
  const free: Cell[] = [];
  for (let row = rows[0]; row <= rows[1]; row += 1) {
    for (let column = columns[0]; column <= columns[1]; column += 1) {
      const x = origin.x + column * cell;
      const box = { x, y: origin.y + row * cell, w: cell, h: cell };
      if (!guarded(box)) free.push({ key: cellKey(column, row), centerX: x + cell / 2 });
    }
  }
  const middle = width / 2;
  const filled = sampleBalanced(free, DECOR_FILL_RATIO, middle, random);
  const diagonalCells = sampleBalanced(free, DECOR_DIAGONAL_RATIO, middle, random);
  const open = sampleBalanced(free, DECOR_OPEN_RATIO, middle, random);
  const diagonals = new Map<string, boolean>();
  for (const cell of free) {
    if (diagonalCells.has(cell.key)) diagonals.set(cell.key, random() < 0.5);
  }

  const marks: DecorMark[] = [];
  const reach = MARK_CLEARANCE * unit;
  const clearance = (x: number, y: number): Rect => ({
    x: x - reach,
    y: y - reach,
    w: 2 * reach,
    h: 2 * reach,
  });
  const target = Math.round((width * height * MARKS_PER_CANVAS) / (1920 * unit * 1080 * unit));
  for (let index = 0; index < target; index += 1) {
    for (let attempt = 0; attempt < MARK_ATTEMPTS; attempt += 1) {
      const x = random() * width;
      const y = random() * height;
      if (guarded(clearance(x, y))) continue;
      marks.push(markOf(x, y, unit, random));
      break;
    }
  }

  const arcs = (options.arcs ?? SHEET_ARCS).map((arc) => ({
    ...arc,
    cx: origin.x + arc.cx * scale,
    cy: origin.y + arc.cy * scale,
    r: arc.r * scale,
  }));
  return {
    width,
    height,
    origin,
    cell,
    unit,
    center,
    columns,
    rows,
    open,
    filled,
    diagonals,
    marks,
    arcs,
  };
}
