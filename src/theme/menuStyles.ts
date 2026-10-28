import { makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { roleVar } from './roles.ts';

export const MENU_OVERLAP = 8;
const SURFACE_FONT_FAMILY = "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif";

export const useMenuStyles = makeStyles({
  typography: {
    '--fontFamilyBase': SURFACE_FONT_FAMILY,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    borderRadius: tokens.borderRadiusXLarge,
  },
  items: {
    '& .fui-MenuList': { rowGap: tokens.spacingVerticalXXS },
    '& [role^="menuitem"], & [role="option"]': {
      minHeight: '32px',
      padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalM}`,
      columnGap: tokens.spacingHorizontalM,
      alignItems: 'center',
      borderRadius: tokens.borderRadiusMedium,
    },
    '& .fui-MenuItem__content': { paddingLeft: 0, paddingRight: 0 },
    '& .fui-MenuItem__icon': { width: '16px', height: '20px', fontSize: tokens.fontSizeBase400 },
    '& .fui-MenuItem__icon svg': { width: '16px', height: '16px' },
    '& .fui-MenuItem__submenuIndicator': {
      width: '12px',
      height: '20px',
      fontSize: tokens.fontSizeBase200,
    },
    '& .fui-MenuItem__submenuIndicator svg': { width: '12px', height: '12px' },
    '& .fui-MenuItem__checkmark': { marginTop: 0 },
    '& .fui-MenuItem__secondaryContent': { paddingLeft: 0, paddingRight: 0 },
    '& .fui-MenuDivider': { margin: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}` },
    '& .fui-MenuGroupHeader': {
      paddingLeft: tokens.spacingHorizontalM,
      paddingRight: tokens.spacingHorizontalM,
      fontWeight: tokens.fontWeightRegular,
    },
    '& .fui-Option__checkIcon': { marginLeft: 0, marginRight: 0, fontSize: tokens.fontSizeBase400 },
    '@media (forced-colors: none)': {
      '& .fui-MenuDivider': { borderBottomColor: roleVar('line') },
      '& [role^="menuitem"]:not([aria-disabled="true"])': {
        color: tokens.colorNeutralForeground1,
        '& .fui-MenuItem__icon': { color: tokens.colorNeutralForeground1 },
        '& .fui-MenuItem__checkmark': { color: tokens.colorBrandForeground1 },
      },
    },
  },
  root: {
    '--menu-reveal-direction': '-1',
    '--menu-reveal-origin': 'top',
    '&[data-popper-placement^="top"], &[data-popper-placement="left-end"], &[data-popper-placement="right-end"]':
      {
        '--menu-reveal-direction': '1',
        '--menu-reveal-origin': 'bottom',
      },
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    ...shorthands.borderWidth(0),
    backgroundColor: 'transparent',
    boxShadow: 'none',
    overflow: 'visible',
  },
  backplate: {
    transformOrigin: 'center var(--menu-reveal-origin, top)',
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    borderRadius: tokens.borderRadiusXLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStrokeAlpha}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    '@media (forced-colors: active)': {
      backgroundColor: 'Canvas',
      ...shorthands.borderColor('CanvasText'),
      boxShadow: 'none',
    },
  },
  viewport: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
  },
  content: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
    padding: tokens.spacingVerticalXS,
  },
});
