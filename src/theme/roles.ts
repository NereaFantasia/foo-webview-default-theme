import { tokens } from '@fluentui/react-components';
import type { ColorScheme } from './themes.ts';

/**
 * 语义变量：按界面上的用途命名（`--bg-pane` 是内容卡的底），取值落到 Fluent token。
 * 组件取色优先写语义变量：CSS Modules 里写 `var(--bg-pane)`，makeStyles 里用 `roleVar('bg-pane')`。
 * 变量由主题根挂在 FluentProvider 上，经 Portal 弹出的菜单、提示里同样取得到。
 */
export const ROLE_VALUES = {
  // 窗口底与内容卡是 Mica 的透出层，必须可透，不能取不透明的中性底。
  'bg-app': 'transparent',
  'bg-pane': tokens.colorNeutralBackgroundAlpha2,
  // 标题栏、浮层、菜单是上层，用不透明中性底，否则文字压在桌面底纹上。
  'bg-titlebar': tokens.colorNeutralBackground3Selected,
  'bg-surface': tokens.colorNeutralBackground2,
  'bg-elevated': tokens.colorNeutralBackground1,
  'bg-menu': tokens.colorNeutralBackground1,
  'bg-hover': tokens.colorSubtleBackgroundSelected,
  // 品牌着色的选中底。不用 colorBrandBackground2：青绿 ramp 下它落到 ramp 的两端档，选中态几乎看不出。
  'bg-selected': `color-mix(in oklab, ${tokens.colorBrandStroke1} 18%, transparent)`,
  // 分隔线取 Stroke2：Stroke3 在浅色档压在 Background2 上对比不足，看不见。
  line: tokens.colorNeutralStroke2,
  'text-primary': tokens.colorNeutralForeground1,
  'text-secondary': tokens.colorNeutralForeground3,
  'text-muted': tokens.colorNeutralForeground4,
  'text-on-accent': tokens.colorNeutralForegroundOnBrand,
  accent: tokens.colorBrandForeground1,
  'accent-strong': tokens.colorBrandForegroundLinkPressed,
  playing: tokens.colorBrandForeground1,
  'playing-fill': tokens.colorBrandBackground,
  error: tokens.colorStatusDangerForeground3,
  'error-bg': tokens.colorStatusDangerBackground1,
  'radius-control': tokens.borderRadiusMedium,
  'radius-card': tokens.borderRadiusXLarge,
  'radius-overlay': tokens.borderRadiusXLarge,
};

export type RoleName = keyof typeof ROLE_VALUES;

export function roleVar(name: RoleName): string {
  return `var(--${name})`;
}

/** 把一组角色取值写成 CSS 自定义属性，给 makeStyles 展开用。 */
export function roleProperties(
  values: Readonly<Partial<Record<RoleName, string>>>,
): Record<`--${string}`, string> {
  const properties: Record<`--${string}`, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) properties[`--${name}`] = value;
  }
  return properties;
}

function acrylicTint(percent: number): string {
  return `color-mix(in srgb, ${tokens.colorNeutralBackground2} ${percent}%, transparent)`;
}

/**
 * 宿主实际用的是 Acrylic 时，窗口底与内容卡改用不透明中性底按比例混入透明，两层各自定浓度，
 * 不受 Alpha token 固定档位的限制。内容卡比窗口底更不透明，材质主要从窗口底透出；深色档两层都更透一些。
 */
export const ACRYLIC_ROLES: Readonly<Record<ColorScheme, Partial<Record<RoleName, string>>>> = {
  light: { 'bg-app': acrylicTint(80), 'bg-pane': acrylicTint(90) },
  dark: { 'bg-app': acrylicTint(60), 'bg-pane': acrylicTint(70) },
};
