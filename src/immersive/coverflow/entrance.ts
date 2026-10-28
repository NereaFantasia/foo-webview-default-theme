import { CURVE, DURATION_MS, type Ease } from '../../motion/timing.ts';
import type { Pose } from './slots.ts';

/**
 * Coverflow 进出场侧面卡片补间动效纯函数
 *
 * 入场时两侧卡片在视图过渡启动 250ms 后自屏幕右侧屏外依次滑向对应槽位，先平着飞，倾角另走一条时间线；
 * 退出时整排卡片原位执行淡出；动效降级时跳过飞行位移，仅在槽位执行透明度渐变
 */

/** 侧面卡片起飞相对延时：封面移动（500 ms）走到一半时起飞 */
export const ENTRY_DELAY_MS = DURATION_MS.normal;
/** 相邻卡片起飞交错间隔时长 */
export const ENTRY_STAGGER_MS = 40;
/** 单张卡片自屏外滑入槽位的飞行时长 */
export const ENTRY_MS = 400;
/** 退出时整排卡片淡出时长 */
export const EXIT_MS = DURATION_MS.fast;
/** 动效降级时的淡入时长 */
export const REDUCED_FADE_MS = DURATION_MS.fast;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 计算指定顺位卡片在给定流逝时间下的入场归一化进度（0 为屏外起点，1 为槽位就位）
 */
export function entryProgress(
  rank: number,
  elapsed: number,
  ease: Ease = CURVE.decelerateMid.ease,
): number {
  const start = ENTRY_DELAY_MS + rank * ENTRY_STAGGER_MS;
  return ease(clamp01((elapsed - start) / ENTRY_MS));
}

/** 计算全部卡片滑入就位的时刻（毫秒） */
export function entryEnd(count: number): number {
  return count <= 0 ? 0 : ENTRY_DELAY_MS + (count - 1) * ENTRY_STAGGER_MS + ENTRY_MS;
}

/** 计算卡片在滑入序列中的相对顺位编号（焦点中心项不参与滑入） */
export function entryRank(index: number, first: number, center: number): number {
  return index - first - (index > center ? 1 : 0);
}

/** 计算屏外起始相对水平位移（基于当前封面边长归一化比例） */
export function offscreenOffset(stageWidth: number, cover: number, size: number): number {
  return stageWidth / 2 / cover + size / 2 + 0.05;
}

/**
 * 倾角开始转的时刻，相对这张卡自己的起飞。位置走 `decelerateMid`，前 100 ms 就走完约 70%，脸早已在窗口里；
 * 倾角若跟着位置转，42° 里近 30° 在这 100 ms 里转完，后面只剩一点点，看不清。所以倾角另走一条时间线：
 * 起飞时先平着飞，这个时刻起开始转，到飞行结束时转完，转的时候正好是封面减速落位的阶段
 */
export const TILT_DELAY_MS = 100;

/** 一张卡起飞后 `flown` 毫秒时倾角转了几成：0 到 1，走点到点曲线，不早于 `TILT_DELAY_MS`、不晚于飞行结束 */
export function tiltProgress(flown: number, ease: Ease = CURVE.pointToPoint.ease): number {
  return ease(clamp01((flown - TILT_DELAY_MS) / (ENTRY_MS - TILT_DELAY_MS)));
}

/** 指定顺位的卡在给定流逝时间下倾角转了几成 */
export function entryTilt(rank: number, elapsed: number): number {
  return tiltProgress(elapsed - (ENTRY_DELAY_MS + rank * ENTRY_STAGGER_MS));
}

/**
 * 入场途中的样子：位置从 `from` 滑到槽位，倾角按自己的进度 `tilt`（0 到 1）从 0 转到目标，其余不变。
 * 先平后倾，叠放的层次比一起转更分明
 */
export function enteringPose(pose: Pose, progress: number, from: number, tilt: number): Pose {
  if (progress >= 1) return pose;
  return { ...pose, offset: from + (pose.offset - from) * progress, tilt: pose.tilt * tilt };
}

/** 退出时整排的不透明度倍数：1 淡到 0，轻退场曲线 */
export function exitFactor(elapsed: number, ease: Ease = CURVE.accelerateMid.ease): number {
  return 1 - ease(clamp01(elapsed / EXIT_MS));
}

/** 减弱动效进入时的不透明度倍数：0 线性淡到 1 */
export function fadeInFactor(elapsed: number): number {
  return clamp01(elapsed / REDUCED_FADE_MS);
}
