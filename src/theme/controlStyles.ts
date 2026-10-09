import { makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { roleVar } from './roles.ts';

// Input 和 Dropdown 把禁用标记放在直接子槽；按钮把它放在根节点。
const ENABLED_CONTROL = '&:not(:disabled, [aria-disabled="true"]):not(:has(> :disabled))';
const CONTROL_STATES = {
  ':hover': { backgroundColor: roleVar('state-hover') },
  ':active': { backgroundColor: roleVar('state-pressed') },
  ':hover:active,:active:focus-visible': { backgroundColor: roleVar('state-pressed') },
};
const FIELD_BORDER = {
  '&:not([aria-invalid="true"]):not(:has(> [aria-invalid="true"]))': {
    ...shorthands.borderColor(tokens.colorNeutralStrokeAlpha),
  },
};

/**
 * 主视图输入框和文字按钮用 field，窗口背景上的输入框用 windowField，图标键和单选键用 icon，筛选标签用 tag。
 * 控件本身不复用阅读面的浓度；状态层只在控件范围内出现，不给工具栏整行铺底。
 */
export const useViewControlStyles = makeStyles({
  tag: {
    '@media (forced-colors: none)': {
      [ENABLED_CONTROL]: {
        ...shorthands.borderColor(tokens.colorNeutralStrokeAlpha),
        backgroundColor: roleVar('bg-selected'),
        color: roleVar('text-primary'),
      },
    },
  },
  field: {
    '@media (forced-colors: none)': {
      [ENABLED_CONTROL]: {
        backgroundColor: roleVar('bg-view-control'),
        ...CONTROL_STATES,
        ...FIELD_BORDER,
      },
      // 原生选项弹出列表独立于闭合控件，不能透出列表后面的正文。
      '& option': {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
      },
    },
  },
  windowField: {
    '@media (forced-colors: none)': {
      [ENABLED_CONTROL]: {
        backgroundColor: roleVar('bg-window-control'),
        ...FIELD_BORDER,
        ':hover': {
          backgroundImage: `linear-gradient(${roleVar('state-hover')}, ${roleVar('state-hover')})`,
        },
        ':active, :hover:active, :active:focus-visible': {
          backgroundImage: `linear-gradient(${roleVar('state-pressed')}, ${roleVar('state-pressed')})`,
        },
      },
    },
  },
  icon: {
    '@media (forced-colors: none)': {
      [ENABLED_CONTROL]: {
        backgroundColor: 'transparent',
        ...CONTROL_STATES,
        '&[aria-checked="true"], &[aria-pressed="true"]': {
          // 选中底叠在状态底色上，悬停和按下时仍保留选中标记。
          backgroundImage: `linear-gradient(${roleVar('bg-selected')}, ${roleVar('bg-selected')})`,
        },
      },
    },
  },
});
