import { makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { roleVar } from '../../theme/roles.ts';
import { backdropDegradedAtom } from '../backdrop/backdropState.ts';
import {
  ACRYLIC_BAR_TINT,
  ACRYLIC_FILTER,
  ACRYLIC_GRAIN,
  ACRYLIC_SHADOW,
  ACRYLIC_SOLID_FILL,
} from '../scene/acrylic.ts';

/** 顶栏控制键边长（CSS 像素）；垂直居中对齐页签行 */
export const CONTROL_KEY_SIZE = 44;

const ENABLED = '&:not(:disabled, [aria-disabled="true"])';
const layer = (color: string) => `linear-gradient(${color}, ${color})`;
const HOVER = layer(roleVar('state-hover'));
const PRESSED = layer(roleVar('state-pressed'));
const SELECTED = layer(roleVar('bg-selected'));

// 控制键采用统一 Acrylic 材质底色；为防 Fluent 默认交互样式覆盖底色，将悬停、按下与选中状态层叠置于 backgroundImage，保持底色稳定
const useStyles = makeStyles({
  key: {
    position: 'relative',
    isolation: 'isolate',
    boxSizing: 'border-box',
    minWidth: `${CONTROL_KEY_SIZE}px`,
    width: `${CONTROL_KEY_SIZE}px`,
    height: `${CONTROL_KEY_SIZE}px`,
    padding: '0',
    borderRadius: tokens.borderRadiusCircular,
    '& .fui-Button__icon': { width: '22px', height: '22px', fontSize: '22px' },
    '& svg': { width: '22px', height: '22px' },
    '@media (forced-colors: none)': {
      ...shorthands.borderWidth(0),
      color: roleVar('text-primary'),
      backgroundColor: 'var(--control-key-fill)',
      boxShadow: ACRYLIC_SHADOW,
      [ENABLED]: {
        ':hover': { backgroundColor: 'var(--control-key-fill)', backgroundImage: HOVER },
        ':active': { backgroundColor: 'var(--control-key-fill)', backgroundImage: PRESSED },
        ':hover:active,:active:focus-visible': {
          backgroundColor: 'var(--control-key-fill)',
          backgroundImage: PRESSED,
        },
        '&[aria-expanded="true"]': {
          backgroundColor: 'var(--control-key-fill)',
          backgroundImage: PRESSED,
        },
        '&[aria-expanded="true"]:hover': { backgroundImage: `${HOVER}, ${PRESSED}` },
        '&[aria-expanded="true"]:active': { backgroundImage: `${PRESSED}, ${PRESSED}` },
        // 激活状态下叠加选中底色，并在其上复合悬停与按下反馈
        '&[aria-pressed="true"]': {
          backgroundColor: 'var(--control-key-fill)',
          backgroundImage: SELECTED,
        },
        '&[aria-pressed="true"]:hover': { backgroundImage: `${HOVER}, ${SELECTED}` },
        '&[aria-pressed="true"]:active': { backgroundImage: `${PRESSED}, ${SELECTED}` },
        '&[aria-pressed="true"]:hover:active': { backgroundImage: `${PRESSED}, ${SELECTED}` },
        '&[aria-pressed="true"]:active:focus-visible': {
          backgroundImage: `${PRESSED}, ${SELECTED}`,
        },
      },
    },
    // 高对比度模式下停用渐变叠加，激活项采用系统高亮色
    '@media (forced-colors: active)': {
      '&[aria-pressed="true"]': { backgroundColor: 'Highlight', color: 'HighlightText' },
    },
  },
  // 胶囊形快捷键：保持相同高度，宽度随文本内容自适应
  esc: {
    width: 'auto',
    paddingInline: tokens.spacingHorizontalXL,
  },
  fill: {
    '--control-key-fill': ACRYLIC_BAR_TINT,
    backdropFilter: ACRYLIC_FILTER,
    '::before': ACRYLIC_GRAIN,
    '@media (prefers-reduced-transparency: reduce)': {
      '--control-key-fill': ACRYLIC_SOLID_FILL,
      backdropFilter: 'none',
      '::before': { display: 'none' },
    },
  },
  solid: {
    '--control-key-fill': ACRYLIC_SOLID_FILL,
    backdropFilter: 'none',
  },
});

/**
 * 获取顶栏控制键样式类名
 *
 * 提供圆形按钮与胶囊快捷键样式；当背景性能守门触发降级时，自动切换为实色填充以保障渲染帧率
 */
export function useControlKeyClasses(): { readonly key: string; readonly esc: string } {
  const classes = useStyles();
  const degraded = useAtomValueRawSync(backdropDegradedAtom);
  const key = mergeClasses(classes.key, degraded ? classes.solid : classes.fill);
  return { key, esc: mergeClasses(key, classes.esc) };
}
