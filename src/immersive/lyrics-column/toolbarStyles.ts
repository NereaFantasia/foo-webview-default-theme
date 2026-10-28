import { makeStyles, tokens } from '@fluentui/react-components';
import { roleVar } from '../../theme/roles.ts';
import {
  ACRYLIC_FILTER,
  ACRYLIC_GRAIN,
  ACRYLIC_PANEL_TINT,
  ACRYLIC_SOLID_FILL,
} from '../scene/acrylic.ts';
import { useSceneFrame } from '../scene/sceneContext.ts';

// 工具栏背景样式对齐 scene/acrylic.ts 规范；面板着色提升至 60%，降级或减弱透明度时回退至 94% 不透明度纯色

/**
 * 歌词工具栏样式覆盖与几何规格
 *
 * 控制按键基准命中区为 28px、圆角 8px，内部图标规范为 18px 并复用次级文本色；
 * 面板背景色通过 --bg-panel-overlay 变量传递至 PopoverSurface
 */
export const useToolbarStyles = makeStyles({
  key: {
    minWidth: '28px',
    width: '28px',
    height: '28px',
    padding: '0',
    borderRadius: tokens.borderRadiusXLarge,
    color: roleVar('text-secondary'),
    '& .fui-Button__icon': { width: '18px', height: '18px', fontSize: '18px' },
    '& svg': { width: '18px', height: '18px' },
  },
  // 宽档排布下的整高图标按键（搜索、译文、音译与歌词设置）
  tall: {
    minWidth: '44px',
    width: '44px',
    height: '100%',
    '& .fui-Button__icon': { width: '22px', height: '22px', fontSize: '22px' },
    '& svg': { width: '22px', height: '22px' },
  },
  // 时间轴校正重置按键
  resetKey: {
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: '0',
    marginInlineEnd: tokens.spacingHorizontalXXS,
    color: roleVar('text-secondary'),
    '& .fui-Button__icon': { width: '16px', height: '16px', fontSize: '16px' },
    '& svg': { width: '16px', height: '16px' },
  },
  // 下拉面板尺寸与内边距规格
  panel: {
    boxSizing: 'border-box',
    width: '240px',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadius2XLarge,
    border: 'none',
  },
  // 面板步进调节按钮排布适配
  stepButton: {
    minWidth: '0',
    paddingInline: tokens.spacingHorizontalXS,
    fontVariantNumeric: 'tabular-nums',
  },
  // 滑块可以收到比 Fluent 缺省的最小宽度更窄；并禁用轨道分段刻度背景
  slider: {
    minWidth: '0',
    '& .fui-Slider__rail::before': { backgroundImage: 'none' },
    '@media (forced-colors: active)': {
      '& .fui-Slider__rail::before': { backgroundImage: 'none' },
    },
  },
  acrylic: {
    '--bg-panel-overlay': ACRYLIC_PANEL_TINT,
    isolation: 'isolate',
    backdropFilter: ACRYLIC_FILTER,
    '::before': ACRYLIC_GRAIN,
    '@media (prefers-reduced-transparency: reduce)': {
      '--bg-panel-overlay': ACRYLIC_SOLID_FILL,
      backdropFilter: 'none',
      boxShadow: tokens.shadow16,
      '::before': { display: 'none' },
    },
  },
  solid: {
    '--bg-panel-overlay': ACRYLIC_SOLID_FILL,
    backdropFilter: 'none',
    boxShadow: tokens.shadow16,
  },
  // 字号步进按键（A- 与 A+）
  fontStep: {
    minWidth: '24px',
    width: '24px',
    height: '24px',
    padding: '0',
    color: roleVar('text-secondary'),
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
  },
  fontStepLarge: { fontSize: tokens.fontSizeBase300 },
  // 折叠收起态单图标展开按键
  mini: {
    minWidth: '40px',
    width: '40px',
    height: '40px',
    padding: '0',
    borderRadius: tokens.borderRadiusXLarge,
    color: roleVar('text-secondary'),
    '& .fui-Button__icon': { width: '20px', height: '20px', fontSize: '20px' },
    '& svg': { width: '20px', height: '20px' },
  },
});

/** 工具栏面板表面样式：亚克力材质；性能守门判定降级时回退至不透明底色 */
export function usePanelSurface(): string {
  const classes = useToolbarStyles();
  return useSceneFrame().degraded ? classes.solid : classes.acrylic;
}

export { useBarSurface } from '../scene/acrylic.ts';
