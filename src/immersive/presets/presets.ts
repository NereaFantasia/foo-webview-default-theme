import type { ComponentType } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import type { EditHandles, HandleInput } from '../scene/editHandles.ts';
import type { OptionSchema } from '../scene/presetOptions.ts';
import type { PanelGroup } from '../scene/presetPanel.ts';
import type { PresetTemplateProps } from '../scene/presetTemplate.ts';
import type { SceneFrame } from '../scene/sceneContext.ts';
import { BleedPreset } from './bleed/BleedPreset.tsx';
import { bleedHandles } from './bleed/bleedHandles.ts';
import { BleedPreview } from './bleed/BleedPreview.tsx';
import { BLEED_MIN_SIZE } from './bleed/bleedLayout.ts';
import { BLEED_SCHEMA } from './bleed/bleedOptions.ts';
import { BLEED_PANEL } from './bleed/bleedPanel.ts';
import { SplitPreset } from './split/SplitPreset.tsx';
import { SplitPreview } from './split/SplitPreview.tsx';
import { SPLIT_MIN_SIZE, sidebarFits } from './split/splitLayout.ts';

type Size = Pick<SceneFrame, 'width' | 'height'>;

/** 预设注册条目；封装模板组件、朝向约束、最小尺寸要求及侧栏容纳判据 */
export interface PresetEntry {
  readonly id: string;
  /** 设置编辑里预设单选显示的名字 */
  readonly name: MessageKey;
  /** 适用屏幕朝向 */
  readonly orientation: 'landscape' | 'portrait' | 'any';
  /** 布局容纳的最小窗口尺寸阈值；窗口更小时改用同朝向的缺省预设，缺省预设自己按比例缩小，不受此限 */
  readonly minSize: { readonly width: number; readonly height: number };
  /** 判定当前窗口规格是否容纳侧栏展示，超出则版式回退至居中模式 */
  sidebarFits(frame: Size): boolean;
  readonly Template: ComponentType<PresetTemplateProps>;
  /** 可调项声明；没有可调项的预设给空表。存档按它校验，面板按它画控件 */
  readonly schema: OptionSchema;
  /** 这个预设的几组可调项；设置编辑里一组是一个分类 */
  readonly panel: readonly PanelGroup[];
  /** 设置编辑里在画面上直接拖的拖柄与手势；没有就只在卡片里调 */
  readonly handles?: (input: HandleInput) => EditHandles;
  /** 设置编辑里预设单选的线框缩略图 */
  readonly Preview: ComponentType<{ readonly className?: string }>;
}

const SPLIT: PresetEntry = {
  id: 'split',
  name: 'immersive.preset.split',
  orientation: 'any',
  minSize: SPLIT_MIN_SIZE,
  sidebarFits,
  Template: SplitPreset,
  schema: {},
  panel: [],
  Preview: SplitPreview,
};

const BLEED: PresetEntry = {
  id: 'bleed',
  name: 'immersive.preset.bleed',
  orientation: 'landscape',
  minSize: BLEED_MIN_SIZE,
  // 最小尺寸已保证放得下右栏
  sidebarFits: () => true,
  Template: BleedPreset,
  schema: BLEED_SCHEMA,
  panel: BLEED_PANEL,
  handles: bleedHandles,
  Preview: BleedPreview,
};

/** 预设注册列表；首项为通用兜底默认预设 */
export const PRESETS: readonly [PresetEntry, ...PresetEntry[]] = [SPLIT, BLEED];

/** 这个预设适不适用于这个朝向 */
export function fitsOrientation(
  entry: PresetEntry,
  orientation: 'landscape' | 'portrait',
): boolean {
  return entry.orientation === 'any' || entry.orientation === orientation;
}

/**
 * 解析指定屏幕朝向与标识对应的生效预设条目
 *
 * 找不到指定预设、朝向不兼容或窗口小于它声明的最小尺寸时，回退至同朝向的缺省预设（登记表里第一个适用的），
 * 缺失专用预设时以首个注册项兜底。不给 `frame` 时不看窗口尺寸
 */
export function presetFor(
  orientation: 'landscape' | 'portrait',
  id: string,
  frame?: Size,
): PresetEntry {
  const roomy = (entry: PresetEntry) =>
    !frame || (frame.width >= entry.minSize.width && frame.height >= entry.minSize.height);
  return (
    PRESETS.find(
      (entry) => entry.id === id && fitsOrientation(entry, orientation) && roomy(entry),
    ) ??
    PRESETS.find((entry) => fitsOrientation(entry, orientation)) ??
    PRESETS[0]
  );
}
