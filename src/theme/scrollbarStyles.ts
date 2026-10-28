import { tokens } from '@fluentui/react-components';

/**
 * 滚动条手柄显隐与平滑淡出阶梯规则
 * 规避 Chromium 对 ::-webkit-scrollbar-* 伪元素不支持 CSS transition 的底层限制，
 * 采用 4 档色彩混合阶梯实现丝滑淡出，且直接通过属性选择器确保跨 SPA 稳定生效
 */
export const SCROLLBAR_CSS_RULES = `
[data-scrollbars-visible='active']::-webkit-scrollbar-thumb,
[data-scrollbars-visible='true']::-webkit-scrollbar-thumb {
  background-color: var(--colorScrollbarOverlay) !important;
}
[data-scrollbars-visible='fade-3']::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--colorScrollbarOverlay) 75%, transparent) !important;
}
[data-scrollbars-visible='fade-2']::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--colorScrollbarOverlay) 50%, transparent) !important;
}
[data-scrollbars-visible='fade-1']::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--colorScrollbarOverlay) 25%, transparent) !important;
}
`;

/** 横向粗度减半为4px，纵向保留8px；手柄平时透明并支持超时淡出，滚动或活动时取半透明覆盖色，轨道与拐角透明 */
export const SCROLLBAR_STYLES = {
  '&::-webkit-scrollbar': { width: '8px', height: '4px', backgroundColor: 'transparent' },
  '&::-webkit-scrollbar:horizontal': { height: '4px' },
  '&::-webkit-scrollbar:vertical': { width: '8px' },
  '&::-webkit-scrollbar-track, &::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
  '&::-webkit-scrollbar-button': { display: 'none' },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'transparent',
    backgroundClip: 'content-box',
    border: '1px solid transparent',
    borderRadius: tokens.borderRadiusCircular,
    '@media (forced-colors: active)': {
      backgroundColor: 'Highlight',
    },
  },
  '&::-webkit-scrollbar-thumb:horizontal': {
    borderTop: 0,
    borderBottom: 0,
    borderLeft: '1px solid transparent',
    borderRight: '1px solid transparent',
  },
  '&::-webkit-scrollbar-thumb:hover, &::-webkit-scrollbar-thumb:active': {
    backgroundColor: tokens.colorNeutralStrokeAccessible,
    '@media (forced-colors: active)': {
      backgroundColor: 'Highlight',
    },
  },
} as const;
