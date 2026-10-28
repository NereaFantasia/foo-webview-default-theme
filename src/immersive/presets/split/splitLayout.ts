import type { KeySize } from '../../playback-keys/keyStyles.ts';
import type { SceneFrame } from '../../scene/sceneContext.ts';
import { INFO_ROW_GAP, INFO_SIZES } from '../../track-info/trackInfoLayout.ts';

/**
 * 预设 1「分栏」的版式数值，全是纯函数，样式与模板只读它们的结果。数值来自泳道 30 的画稿，
 * 1280 × 800 是基准；窗高、封面边长怎么换成档位与收键在这里一处定
 */

/** 声明的最小尺寸；窗口更小时整体等比缩小放进去，不裁、不滚动 */
export const SPLIT_MIN_SIZE = { width: 400, height: 364 } as const;

/** 窗宽（缩放后的）小于它时侧栏放不下，版式退到居中 */
export const SIDEBAR_MIN_WIDTH = 700;

/** 封面边长的下限：上一首、播放、下一首、音量四个键各 40，音量始终留着 */
export const COVER_MIN = 160;

/** 控制层让位：封面列内容上下各留这么多 */
export const COLUMN_EDGE = 56;

/** 封面边长随窗口变，列内固定内容（曲目信息、进度、传输键与间隔）占的高度 */
const COLUMN_FIXED_HEIGHT = 194;

export type SplitSize = 'large' | 'medium' | 'small';

/** 窗口小到版式要压缩的界限：窗高低于它时字号取 `small`，键 36，间隔变小 */
export const COMPACT_HEIGHT = 466;

/** 窗高不到这么高时曲名、歌词字号取 `medium`（800 取 `large`，600 取 `medium`，取两者中点） */
const LARGE_HEIGHT = 700;

export function sizeOf(height: number): SplitSize {
  if (height >= LARGE_HEIGHT) return 'large';
  return height >= COMPACT_HEIGHT ? 'medium' : 'small';
}

export const isCompact = (height: number): boolean => height < COMPACT_HEIGHT;

/** 整体等比缩小的比例：窗口小于最小尺寸时 `min(宽 ÷ 400, 高 ÷ 364)`，否则 1 */
export function fitScale(frame: Pick<SceneFrame, 'width' | 'height'>): number {
  if (frame.width <= 0 || frame.height <= 0) return 1;
  return Math.min(1, frame.width / SPLIT_MIN_SIZE.width, frame.height / SPLIT_MIN_SIZE.height);
}

/** 缩放前的排版尺寸：缩小时反过来放大，排完再整体缩回去 */
export function layoutBox(frame: Pick<SceneFrame, 'width' | 'height'>): {
  readonly width: number;
  readonly height: number;
} {
  const scale = fitScale(frame);
  return { width: frame.width / scale, height: frame.height / scale };
}

/** 侧栏放不放得下：窗宽（缩放后的）不到 700 就退居中，页签与菜单里的侧栏开关也不画 */
export function sidebarFits(frame: Pick<SceneFrame, 'width' | 'height'>): boolean {
  return layoutBox(frame).width >= SIDEBAR_MIN_WIDTH;
}

/** 封面边长 `min(50vh, 38vw, 100vh − 306)`，不小于 160，取整免得静止时文字逐帧跳 */
export function coverSizeOf(box: { readonly width: number; readonly height: number }): number {
  const fit = Math.min(
    box.height * 0.5,
    box.width * 0.38,
    box.height - COLUMN_FIXED_HEIGHT - 2 * COLUMN_EDGE,
  );
  return Math.max(COVER_MIN, Math.floor(fit));
}

/** 传输行按封面宽收键：≥ 216 五个键都在；176 到 216 收掉播放顺序；不到 176 再去掉音量前的间隔 */
export function keyRowOf(cover: number): { readonly order: boolean; readonly volumeGap: boolean } {
  return { order: cover >= 216, volumeGap: cover >= 176 };
}

/** 封面下方各块的间隔，CSS 像素：封面到曲目信息、信息到进度的线、进度到传输键 */
export interface SplitGaps {
  readonly cover: number;
  readonly info: number;
  readonly keys: number;
}

/**
 * 画稿的间隔是 24、20、16（窗高不到 466 时 16、12、8）。进度元素的命中区上下各比线多 8，间隔要把它扣掉：
 * 信息到线 20 写成 12，进度到传输键 16 写成 8
 */
export function gapsOf(height: number): SplitGaps {
  return isCompact(height) ? { cover: 16, info: 4, keys: 0 } : { cover: 24, info: 12, keys: 8 };
}

/** 控制按键命中区边长规格（紧凑视口为 36px，常规视口为 40px） */
export const keyBoxOf = (height: number): number => (isCompact(height) ? 36 : 40);

/** 进度组件总高度（进度条 6px、命中区上下各 8px 及底部时间行） */
export const PROGRESS_HEIGHT = 44;

/** 传输控制行大按键命中区边长与最小容纳封面宽度 */
const LARGE_KEY_BOX = 48;
const LARGE_KEYS_MIN_COVER = 5 * LARGE_KEY_BOX + 16;

/**
 * 计算传输控制行（播放顺序、上一曲、播放/暂停、下一曲、音量）控件尺寸规格
 *
 * 紧凑高度（窗高 < 466）取 compact（36px）；大窗高（字号大档）且封面宽度容纳大按键序列时取 large（48px，图标 28px）；
 * 其余规格回退至 regular（40px）；中档窗高受列内垂直高度约束不放大按键尺寸，避免压缩封面区域
 */
export function keySizeOf(height: number, cover: number): KeySize {
  if (isCompact(height)) return 'compact';
  return height >= LARGE_HEIGHT && cover >= LARGE_KEYS_MIN_COVER ? 'large' : 'regular';
}

/** 键档位对应的命中区边长 */
const KEY_BOX: Readonly<Record<KeySize, number>> = { compact: 36, regular: 40, large: 48 };

/** 封面列整组（封面、曲目信息行、进度、传输行）的尺寸，CSS 像素 */
export interface StackLayout {
  readonly cover: number;
  /** 三行的固定高；模板把它们写成各行的高，整组的高因此是这些加间隔，不用量 */
  readonly rows: { readonly info: number; readonly progress: number; readonly keys: number };
  /** 整组的上沿距预设框顶，取整免得文字落在半个像素上 */
  readonly top: number;
  readonly height: number;
}

/**
 * 封面列整组的尺寸与位置。整组在预设框里垂直居中，上沿至少让开控制层的 `COLUMN_EDGE`；曲目信息行取两行字
 * 加行距与更多键里高的那个。歌词工具条的上沿、队列与历史页的列上下都对齐这一组，所以由这里一处算出，
 * 模板把 `top` 与各行的高写成样式，两边用的是同一组数
 */
export function stackOf(box: { readonly width: number; readonly height: number }): StackLayout {
  const cover = coverSizeOf(box);
  const gaps = gapsOf(box.height);
  const text = INFO_SIZES[sizeOf(box.height)];
  const rows = {
    info: Math.max(text.titleLine + INFO_ROW_GAP + text.subLine, keyBoxOf(box.height)),
    progress: PROGRESS_HEIGHT,
    keys: KEY_BOX[keySizeOf(box.height, cover)],
  };
  const height = cover + gaps.cover + rows.info + gaps.info + rows.progress + gaps.keys + rows.keys;
  const top = Math.max(COLUMN_EDGE, Math.round((box.height - height) / 2));
  return { cover, rows, top, height };
}

/** 封面列占窗宽的比例，侧栏是余下的；整组的居中范围却算到窗口正中线 */
const COVER_COLUMN_RATIO = 0.45;
const CENTER_LINE_RATIO = 0.5;

/**
 * 有侧栏时封面列的右缘往侧栏里伸的量，CSS 像素：整组在「窗口左缘到窗口正中线」之间居中，也就是 0.45 栏再多
 * 算 0.05 倍窗宽。只按 0.45 栏居中，眼睛里整组偏左：顶部页签在正中线上，封面离正中线比离窗口左缘远
 */
export function columnReachOf(box: { readonly width: number }): number {
  return Math.round(box.width * (CENTER_LINE_RATIO - COVER_COLUMN_RATIO));
}
