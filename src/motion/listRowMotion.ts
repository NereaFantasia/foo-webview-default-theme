import { tokens, type GriffelStyle } from '@fluentui/react-components';
import { CURVE, durationVar } from './timing.ts';

/**
 * 列表行状态变化的样式，照 WinUI 列表项。行底色（悬停、按下、选中）83 ms 线性过渡，同 WinUI 列表项与按钮底色的
 * BrushTransition。文字色不过渡：深浅色切换时别处的字都当场换色，行里的字不该慢一拍。
 *
 * 选中指示条画在行的 `::before` 上，3 × 16 px，贴在行首、竖向居中（`ListViewBaseItemChrome` 的
 * `s_selectionIndicatorSize`）。选中时 83 ms 淡入，同时竖向从 0 放大到全高，167 ms、`(0.167,0.167,0,1)`、
 * 以中心为原点；取消选中只淡出，淡完再缩回去（`ListViewBaseItemPresenter` 的选中指示条动画）。
 *
 * 用过渡而不用 CSS 动画：过渡只在同一个元素的状态变了时播，虚拟列表里滚进视口、新挂上的选中行直接画成
 * 选中的样子，不在滚动时一行行地播。减弱动效时时长变量是 1 ms。行要自己是定位元素，指示条按它摆。
 */
export const LIST_ROW_MOTION: GriffelStyle = {
  transitionProperty: 'background-color',
  transitionDuration: durationVar('faster'),
  transitionTimingFunction: CURVE.linear.css,
  '::before': {
    content: '""',
    position: 'absolute',
    top: 'calc(50% - 8px)',
    left: tokens.spacingHorizontalXS,
    width: '3px',
    height: '16px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorCompoundBrandForeground1,
    opacity: 0,
    transform: 'scaleY(0)',
    pointerEvents: 'none',
    transitionProperty: 'opacity, transform',
    transitionDuration: `${durationVar('faster')}, 0s`,
    transitionDelay: `0s, ${durationVar('faster')}`,
    transitionTimingFunction: CURVE.linear.css,
  },
};

/** 选中的行；与 `LIST_ROW_MOTION` 一起用，排在它后面。 */
export const LIST_ROW_SELECTED_MOTION: GriffelStyle = {
  '::before': {
    opacity: 1,
    transform: 'none',
    transitionDuration: `${durationVar('faster')}, ${durationVar('fast')}`,
    transitionDelay: '0s',
    transitionTimingFunction: `${CURVE.linear.css}, ${CURVE.indicator.css}`,
  },
};
