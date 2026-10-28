import type { ComponentType } from 'react';
import type { SceneFrame } from '../scene/sceneContext.ts';
import type { SceneView } from '../scene/sceneState.ts';
import { SplitPreset } from './split/SplitPreset.tsx';
import { SPLIT_MIN_SIZE, sidebarFits } from './split/splitLayout.ts';

/** 预设注册条目；封装模板组件、朝向约束、最小尺寸要求及侧栏容纳判据 */
export interface PresetEntry {
  readonly id: string;
  /** 适用屏幕朝向 */
  readonly orientation: 'landscape' | 'portrait' | 'any';
  /** 布局容纳的最小窗口尺寸阈值 */
  readonly minSize: { readonly width: number; readonly height: number };
  /** 判定当前窗口规格是否容纳侧栏展示，超出则版式回退至居中模式 */
  sidebarFits(frame: Pick<SceneFrame, 'width' | 'height'>): boolean;
  readonly Template: ComponentType<{ readonly scene: SceneView }>;
}

const SPLIT: PresetEntry = {
  id: 'split',
  orientation: 'any',
  minSize: SPLIT_MIN_SIZE,
  sidebarFits,
  Template: SplitPreset,
};

/** 预设注册列表；首项为通用兜底默认预设 */
export const PRESETS: readonly [PresetEntry, ...PresetEntry[]] = [SPLIT];

/**
 * 解析指定屏幕朝向与标识对应的生效预设条目
 *
 * 找不到指定预设或朝向不兼容时回退至同朝向默认预设，缺失专用预设时以首个注册项兜底
 */
export function presetFor(orientation: 'landscape' | 'portrait', id: string): PresetEntry {
  const fits = (entry: PresetEntry) =>
    entry.orientation === 'any' || entry.orientation === orientation;
  return (
    PRESETS.find((entry) => entry.id === id && fits(entry)) ?? PRESETS.find(fits) ?? PRESETS[0]
  );
}
