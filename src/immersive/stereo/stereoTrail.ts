import type { StereoPoint } from './stereoField.ts';

/**
 * 声场轨迹的放法、余辉与亮度。宿主答的一窗是截至「现在」的最近 30 ms，到手时整窗都已播过。
 * 按播到的时刻原样画，新样本只在每窗到手那一刻成截冒出来，屏幕刷新比取数快时一截一跳；
 * 这里让每个样本晚 `REVEAL_LAG_MS` 再放：第 j 个点在 `at + j · span / 点数` 才画，每帧只多出这一帧里该放的那一截，
 * 像示波器的光点一路扫过去。下一窗接手的那一刻就改放下一窗，这一窗其后的部分丢掉——两窗是同一条流上的切片，
 * 新窗往回够 30 ms，丢掉的那截新窗里也有。
 *
 * 放出的样本按放出之后的时长变淡（半衰期 `TRAIL_HALF_LIFE_MS`），每段线再按长度调暗：示波器的电子束走得越快越暗，
 * 高频成分画出来是满框的长尖刺，调暗后退到背景里，低频的圆弧与椭圆最亮。
 *
 * 余辉是每帧按时刻重算亮度重画出来的，不在 canvas 上逐帧叠一层半透明去擦：8 位的透明度按比例乘下去，
 * 最后几个色阶可能停住不降、留下残影。同一档透明度的线段并进同一条路径，一帧最多描 `TRAIL_LEVELS` 次边；
 * 相邻两段落在同一档时连成一笔，不另起子路径。
 */
export interface TrailWindow {
  points: readonly StereoPoint[];
  /** 这一窗第一个点放出的时刻，与重画回调的时间戳同一条时间轴（毫秒）；由 `arrivedWindow` 按到手时刻算。 */
  at: number;
  /** 窗长（毫秒）。 */
  span: number;
}

/** 按档收线段：`level` 越大越淡，透明度见 `levelAlpha`。 */
export interface TrailSink {
  moveTo(level: number, x: number, y: number): void;
  lineTo(level: number, x: number, y: number): void;
}

/**
 * 样本播到之后再过多久放出（毫秒）。取数每 16.7 ms 一窗、实测到手间隔 p95 19.8 ms：晚这么多放，
 * 下一窗多半在这一窗放完之前到手，光点一路接着扫；晚到的那一拍停一下、到手后补上，两窗隔得不超过窗长就不缺样本。
 */
export const REVEAL_LAG_MS = 20;
/**
 * 样本放出之后亮度减半所需的时间（毫秒）。余辉拖得越长，图形换得越慢、看着越钝；
 * 每个样本都画成一段线，余辉越长，一帧要描的线段越多。
 */
export const TRAIL_HALF_LIFE_MS = 40;
/** 线段短于这个长度（CSS 像素）按满亮度画，更长的按长度反比调暗。 */
export const BEAM_FULL_LENGTH = 2;
/** 透明度分档数：第 k 档画 2^(−k/2)，最淡一档约 4%；比 `MIN_ALPHA`（最淡一档再淡半档）还淡的线段不画。 */
export const TRAIL_LEVELS = 10;

const MIN_ALPHA = 2 ** (-(TRAIL_LEVELS - 0.5) / 2);
/** 放出之后超过这个时长的样本比最淡一档还淡，不再画。 */
export const TRAIL_MAX_AGE_MS = TRAIL_HALF_LIFE_MS * Math.log2(1 / MIN_ALPHA);

export function windowAlpha(ageMs: number): number {
  return ageMs > 0 ? 0.5 ** (ageMs / TRAIL_HALF_LIFE_MS) : 1;
}

export function beamAlpha(length: number): number {
  return length > BEAM_FULL_LENGTH ? BEAM_FULL_LENGTH / length : 1;
}

/** 透明度落在哪一档（取最近的一档，正好在两档中间时归淡的那档）；比最淡一档还淡给 `null`。 */
export function levelOf(alpha: number): number | null {
  if (!(alpha >= MIN_ALPHA)) return null;
  return Math.min(TRAIL_LEVELS - 1, Math.max(0, Math.round(-2 * Math.log2(alpha))));
}

export function levelAlpha(level: number): number {
  return 2 ** (-level / 2);
}

/**
 * 刚到手的一窗：`points` 是截至 `arrivedAt` 的最近 `span` 毫秒，第 j 个点在 `arrivedAt − span + j · span / 点数` 播到，
 * 再晚 `REVEAL_LAG_MS` 放出。
 */
export function arrivedWindow(
  points: readonly StereoPoint[],
  arrivedAt: number,
  span: number,
): TrailWindow {
  return { points, at: arrivedAt - span + REVEAL_LAG_MS, span };
}

/** 这一窗放到哪一刻为止：窗尾，或者下一窗接手的那一刻，取早的。 */
const ownEnd = (entry: TrailWindow, next: TrailWindow | undefined): number =>
  Math.min(entry.at + entry.span, next?.at ?? Number.POSITIVE_INFINITY);

/** 丢掉 `now` 时放过的部分已全部淡到看不见的窗。`windows` 按到达先后排。 */
export function pruneTrail(windows: readonly TrailWindow[], now: number): TrailWindow[] {
  return windows.filter(
    (entry, index) => ownEnd(entry, windows[index + 1]) >= now - TRAIL_MAX_AGE_MS,
  );
}

/**
 * 把 `now` 时刻该画的线段按档交给 `sink`：各窗放到 `now`、窗尾或下一窗接手为止，更早的淡到看不见就不画。
 * `windows` 按到达先后排。点的坐标是框的半边长为 1 的单位，`half` 是半边长的 CSS 像素数，y 向上为正；
 * 给出的坐标是 canvas 坐标（y 向下）。
 */
export function traceTrail(
  windows: readonly TrailWindow[],
  now: number,
  half: number,
  sink: TrailSink,
): void {
  windows.forEach((entry, index) => {
    const { points, at, span } = entry;
    if (points.length < 2 || !(span > 0)) return;
    const step = span / points.length;
    const end = Math.min(now, ownEnd(entry, windows[index + 1]));
    const first = Math.max(1, Math.ceil((now - TRAIL_MAX_AGE_MS - at) / step));
    const last = Math.min(points.length - 1, Math.floor((end - at) / step));
    let previous: number | null = null;
    for (let sample = first; sample <= last; sample += 1) {
      const from = points[sample - 1];
      const to = points[sample];
      if (!from || !to) continue;
      const x0 = half + from.x * half;
      const y0 = half - from.y * half;
      const x1 = half + to.x * half;
      const y1 = half - to.y * half;
      const fade = windowAlpha(now - (at + sample * step));
      const level = levelOf(fade * beamAlpha(Math.hypot(x1 - x0, y1 - y0)));
      if (level !== null) {
        if (level !== previous) sink.moveTo(level, x0, y0);
        sink.lineTo(level, x1, y1);
      }
      previous = level;
    }
  });
}
