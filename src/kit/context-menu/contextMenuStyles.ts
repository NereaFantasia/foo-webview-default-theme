import { makeStyles, tokens } from '@fluentui/react-components';
import { SCROLLBAR_STYLES } from '../../theme/scrollbarStyles.ts';

export const useContextMenuStyles = makeStyles({
  surface: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: 'max-content',
    overflow: 'hidden',
    padding: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
  },
  list: {
    marginRight: `calc(-1 * ${tokens.spacingHorizontalXS})`,
    paddingRight: tokens.spacingHorizontalXS,
    minWidth: 0,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    scrollbarGutter: 'auto',
    flex: '1 1 auto',
    // 局部主题的Portal不带外层Provider类，滚动区直接应用共用样式
    ...SCROLLBAR_STYLES,
  },
  item: {
    maxWidth: 'none',
    minHeight: '32px',
    flexShrink: 0,
    '&[data-fui-focus-visible]::after': {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
  },
  tooltip: {
    pointerEvents: 'none',
  },
  content: {
    minWidth: 0,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  badge: {
    marginLeft: tokens.spacingHorizontalS,
  },
  secondary: {
    flexShrink: 0,
    maxWidth: '40%',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  back: {
    flexShrink: 0,
    justifyContent: 'flex-start',
    marginBottom: tokens.spacingVerticalXS,
  },
});
