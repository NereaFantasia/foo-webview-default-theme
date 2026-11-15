import type { KeySize } from '../../playback-keys/keyStyles.ts';
import {
  COMPACT_HEIGHT,
  LARGE_HEIGHT,
  heightTierOf,
  type HeightTier,
} from '../../scene/heightTier.ts';
import type { SceneFrame } from '../../scene/sceneContext.ts';
import { INFO_ROW_GAP, INFO_SIZES } from '../../track-info/trackInfoLayout.ts';

/**
 * 预设 1「分栏」的版式数值计算，均为纯函数，样式与模板统一消费计算结果。
 * 以 1280 × 800 为基准视口，集中定义窗高、封面边长到档位与按键尺寸的换算规则
 */

/** 声明的最小视口尺寸。窗口更小时整体等比缩放容纳，不裁剪、不产生滚动条 */
export const SPLIT_MIN_SIZE = { width: 400, height: 364 } as const;

/** 缩放后窗宽小于此阈值时侧栏无法完整容纳，版式回退至居中布局 */
export const SIDEBAR_MIN_WIDTH = 700;

/** 封面边长下限：上一首、播放、下一首、音量四个按键各 40px，音量键始终保留 */
export const COVER_MIN = 160;

/** 控制层避让留白：封面列内容上下各保留此安全间距 */
export const COLUMN_EDGE = 56;

/** 封面边长随视口变化，列内固定内容（曲目信息、进度、控制按键与间距）所占用的基准高度 */
const COLUMN_FIXED_HEIGHT = 194;

export type SplitSize = HeightTier;

/** 曲名、歌词字号档位，阈值定义于 `scene/heightTier.ts`。窗高低于压缩界限时按键尺寸调整为 36px，间距相应收紧 */
export const sizeOf = heightTierOf;

export const isCompact = (height: number): boolean => height < COMPACT_HEIGHT;

/** 整体等比缩小比例：窗口小于最小尺寸时取 `min(宽 ÷ 400, 高 ÷ 364)`，否则为 1 */
export function fitScale(frame: Pick<SceneFrame, 'width' | 'height'>): number {
  if (frame.width <= 0 || frame.height <= 0) return 1;
  return Math.min(1, frame.width / SPLIT_MIN_SIZE.width, frame.height / SPLIT_MIN_SIZE.height);
}

/** 缩放前的排版尺寸：视口缩小时反向缩放计算，完成排版后再整体等比缩放呈现 */
export function layoutBox(frame: Pick<SceneFrame, 'width' | 'height'>): {
  readonly width: number;
  readonly height: number;
} {
  const scale = fitScale(frame);
  return { width: frame.width / scale, height: frame.height / scale };
}

/** 侧栏容纳判断：缩放后窗宽小于 700px 时回退至居中布局，页签与菜单中的侧栏切换项亦不渲染 */
export function sidebarFits(frame: Pick<SceneFrame, 'width' | 'height'>): boolean {
  return layoutBox(frame).width >= SIDEBAR_MIN_WIDTH;
}

/** 封面边长计算 `min(50vh, 38vw, 100vh − 306)`，不小于 160px，向下取整以避免静态呈现时文字逐帧抖动 */
export function coverSizeOf(box: { readonly width: number; readonly height: number }): number {
  const fit = Math.min(
    box.height * 0.5,
    box.width * 0.38,
    box.height - COLUMN_FIXED_HEIGHT - 2 * COLUMN_EDGE,
  );
  return Math.max(COVER_MIN, Math.floor(fit));
}

/**
 * 传输控制行根据封面宽度动态调整按键显示：
 * - 封面宽度 ≥ 216px：五个按键完整显示
 * - 封面宽度处于 176px 至 216px：收起播放顺序切换键
 * - 封面宽度 < 176px：进一步收起音量键前的空白间距
 */
export function keyRowOf(cover: number): { readonly order: boolean; readonly volumeGap: boolean } {
  return { order: cover >= 216, volumeGap: cover >= 176 };
}

/** 信息行收藏按键容纳判断：封面列宽度小于 216px 时曲目文字可用宽度较窄，收藏操作收归至更多菜单中 */
export const favoriteKeyFits = (cover: number): boolean => cover >= 216;

/** 封面下方各功能块之间的垂直间距（CSS 像素）：封面至曲目信息、信息至进度槽线、进度至传输控制按键 */
export interface SplitGaps {
  readonly cover: number;
  readonly info: number;
  readonly keys: number;
}

/**
 * 标准设计间距为 24px、20px、16px（视口高度小于 466px 时为 16px、12px、8px）
 * 进度条元素的交互命中区上下各超出刻度线 8px，计算间距时须扣除该命中区溢出量：
 * 信息行至刻度线间距由 20px 扣减为 12px，进度槽至控制按键间距由 16px 扣减为 8px
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
 * 计算传输控制行（播放顺序、上一曲、播放/暂停、下一曲、音量）的控件尺寸规格
 *
 * 紧凑高度（窗高 < 466）取 compact（36px）；大窗高（字号大档）且封面宽度容得下大按键序列时取 large（48px，图标 28px），
 * 其余情况回退为 regular（40px）。中档窗高受列内垂直高度约束，不放大按键尺寸，避免压缩封面区域
 */
export function keySizeOf(height: number, cover: number): KeySize {
  if (isCompact(height)) return 'compact';
  return height >= LARGE_HEIGHT && cover >= LARGE_KEYS_MIN_COVER ? 'large' : 'regular';
}

/** 键档位对应的命中区边长 */
const KEY_BOX: Readonly<Record<KeySize, number>> = { compact: 36, regular: 40, large: 48 };

/** 封面列整组元素（封面、曲目信息行、进度、传输控制行）的尺寸规格（CSS 像素） */
export interface StackLayout {
  readonly cover: number;
  /** 三行的固定高度。样式层将其设为各行高度，整组总高度直接由行高与间距累加得出 */
  readonly rows: { readonly info: number; readonly progress: number; readonly keys: number };
  /** 整组顶部相对预设容器上沿的距离，取整以避免文字排版落于次像素位置 */
  readonly top: number;
  readonly height: number;
}

/**
 * 封面列整组元素的尺寸与位置
 *
 * 整组在预设容器内垂直居中，上沿至少避让控制层的 `COLUMN_EDGE`。
 * 曲目信息行高度取双行文本加行距与更多操作键高度的最大值。
 * 歌词工具栏上沿、播放队列与播放历史视图列的上下边界都对齐这一组，所以由这里统一计算：
 * 样式层把 `top` 与各行高度写成样式，两边使用同一组数值
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

/** 封面列占视口宽度的比例（侧栏占用剩余宽度）。整组元素的水平居中范围则计算至视口中心线 */
const COVER_COLUMN_RATIO = 0.45;
const CENTER_LINE_RATIO = 0.5;

/**
 * 侧栏展开时封面列右边界向侧栏区域延伸的补偿量（CSS 像素）
 *
 * 整组元素在「视口左边界至视口中心线」区间内水平居中（即 0.45 栏宽追加 0.05 倍视口宽度）。
 * 若仅按 0.45 栏宽居中，视觉上整组元素偏左（顶部页签位于视口中心线上，导致封面相对中心线距离偏大）
 */
export function columnReachOf(box: { readonly width: number }): number {
  return Math.round(box.width * (CENTER_LINE_RATIO - COVER_COLUMN_RATIO));
}
