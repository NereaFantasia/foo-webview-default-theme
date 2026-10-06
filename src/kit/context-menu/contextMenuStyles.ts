import { makeStyles, tokens } from '@fluentui/react-components';

export const useContextMenuStyles = makeStyles({
  surface: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: 'max-content',
    overflow: 'hidden',
    padding: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
  },
  list: {
    minWidth: 0,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    scrollbarGutter: 'stable',
    flex: '1 1 auto',
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
