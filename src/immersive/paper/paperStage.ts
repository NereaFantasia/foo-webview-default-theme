import type { DecorArc, Rect } from '../decor/paperDecor.ts';
import type { OrbitSpec } from '../dial/orbit.ts';

/**
 * full 档的舞台：排版取自 catbot-3 网页版 `audio-stage.js` 的 1920 × 1080 舞台，各块位置用它的常量。
 * 舞台整幅等比缩放、居中放进容器，容器比 16:9 宽或高出来的部分由背景层铺满；这里的坐标都是舞台坐标
 * （舞台左上为原点，单位舞台像素）。只有要在脚本里算的几何放这里，纯样式的位置写在各组件的样式里。
 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;
/**
 * 用舞台的最小容器：缩放到 2/3 时舞台里最小的 13 px 字约 8.7 px，与版心档最小的字相当；再小就落收缩档。
 * 按整数像素判，免得 720 / 1080 这类比值的浮点尾巴把正好 2/3 的窗口判出去。
 */
export const STAGE_MIN_WIDTH = 1280;
export const STAGE_MIN_HEIGHT = 720;

export function fitsStage(width: number, height: number): boolean {
  return width >= STAGE_MIN_WIDTH && height >= STAGE_MIN_HEIGHT;
}

/** 舞台缩放：宽高两个比值中较小的那个，舞台整幅放得进容器。 */
export function stageScale(width: number, height: number): number {
  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
}

/** 舞台左上角在容器里的位置（容器坐标）：居中。 */
export function stageOrigin(
  width: number,
  height: number,
  scale: number,
): { x: number; y: number } {
  return { x: (width - STAGE_WIDTH * scale) / 2, y: (height - STAGE_HEIGHT * scale) / 2 };
}

/**
 * 在容器里量到的盒子换回舞台坐标：舞台整幅 `scale(s)` 过，DOM 上量到的是缩放后的尺寸，
 * 先减去舞台左上角的偏移、再除以 `s`。
 */
export function toStageRect(rect: Rect, origin: { x: number; y: number }, scale: number): Rect {
  return {
    x: (rect.x - origin.x) / scale,
    y: (rect.y - origin.y) / scale,
    w: rect.w / scale,
    h: rect.h / scale,
  };
}

/** 罗盘：圆心、三圈实线环、封面与四角括号臂长。封面中心在 (380, 500)，比环心高 12，与网页版相同。 */
export const STAGE_DIAL = { x: 380, y: 512 } as const;
export const STAGE_RINGS: readonly number[] = [268, 342, 440];
export const STAGE_COVER = { x: 150, y: 270, size: 460, bracket: 38 } as const;
/**
 * 封面请求档：舞台里的 460 在 s = 1 时取 512 这一档。与档位和 s 都无关，换档、改窗口大小都不重取图，
 * 封面底色也不重建。
 */
export const COVER_REQUEST = 512;
/** 右栏：左缘、From 行的顶边与栏宽。 */
export const STAGE_FIELDS = { x: 760, y: 82, width: 1020 } as const;

export interface StageTick {
  text: string;
  /** 字的水平中心与基线。 */
  x: number;
  base: number;
  hot: boolean;
}

/** 刻度字：W 在正上、N 在正左（离圆心 358），270 / 90 在封面两侧，`^` / `v` 贴封面上下缘。 */
export const STAGE_TICKS: readonly StageTick[] = [
  { text: 'W', x: 380, base: 161, hot: false },
  { text: 'N', x: 22, base: 519, hot: false },
  { text: '270', x: 106, base: 518, hot: false },
  { text: '90', x: 656, base: 518, hot: false },
  { text: '^', x: 380, base: 254, hot: true },
  { text: 'v', x: 380, base: 758, hot: true },
];

/** 传输三键：圆心的 x 与共同的 y，两侧键与中键的直径。 */
export const STAGE_TRANSPORT = { centers: [238, 380, 522], y: 924, side: 72, play: 108 } as const;

/** 转动层：两圈虚线环落在三圈实线环之间，辐条贴最外环内侧，四个轨道点的半径、初始角与直径照网页版。 */
export const STAGE_ORBIT: OrbitSpec = {
  dashed: { inner: 304, outer: 386 },
  spokes: { outer: 434, innerLong: 402, innerShort: 418 },
  dots: [
    { radius: 440, degrees: 202, diameter: 10 },
    { radius: 416, degrees: 16, diameter: 8 },
    { radius: 366, degrees: 300, diameter: 6 },
    { radius: 328, degrees: 128, diameter: 6 },
  ],
  extent: 450,
};

/**
 * 右栏仪表垫纸：顶边与封面顶边齐平，上下内边距都是 26（顶边到仪表第一行、量表值条到底边），
 * 底边在两行歌词卡顶上方 8，两者不叠；
 * 左边让出频谱纵轴的刻度字。
 */
export const STAGE_PAD: Rect = { x: 688, y: STAGE_COVER.y, w: 1124, h: 956 - STAGE_COVER.y };
/** 四个定位十字，避开封面、传输键、右栏与最窄的歌词卡。 */
export const STAGE_CROSSES: readonly (readonly [number, number])[] = [
  [716, 176],
  [1848, 420],
  [96, 1004],
  [716, 1004],
];
/** 三段仪表弧：绕罗盘圆心、圆心在右栏右缘左边 80、绕画面中心；数都是网页版的。 */
export const STAGE_ARCS: readonly DecorArc[] = [
  { cx: STAGE_DIAL.x, cy: STAGE_DIAL.y, r: 548, from: -2.95, to: 0.58, ticks: 11 },
  { cx: 1700, cy: 575, r: 438, from: 2.9, to: 5.05, ticks: 8 },
  { cx: 960, cy: 542, r: 860, from: 3.52, to: 4.42, ticks: 5 },
];

/** 标题：宽上限是右栏 1020 的 92%；字号从 76 起，放不下每次降 3 px，最小 62，仍放不下再滚动。 */
export const STAGE_TITLE = { width: 938, font: { max: 76, min: 62, step: 3 } } as const;
/** 标题滚动速度与擦除软边，舞台像素，网页版原值。 */
export const STAGE_TITLE_SPEED = 80;
export const STAGE_TITLE_SOFTNESS = 96;

/** full 档交给 `paperTiers.ts` 的几何：舞台尺寸、罗盘圆心与传输键到圆心的距离、右栏位置、十字与垫纸。 */
export const STAGE_LAYOUT = {
  sheet: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
  dial: { ...STAGE_DIAL, scale: 1, transportOffset: STAGE_TRANSPORT.y - STAGE_DIAL.y },
  fields: { ...STAGE_FIELDS, mode: 'full' as const },
  crosses: STAGE_CROSSES,
  pad: STAGE_PAD,
};

/** 歌词卡的正文宽上限（卡宽上限 1520 减去左右内边距 46 与 46 + 34）与两行正文降字号的下限。 */
export const LYRIC_TEXT_WIDTH = 1394;
export const LYRIC_FONT = { main: 38, minMain: 20, sub: 24, minSub: 16 } as const;
