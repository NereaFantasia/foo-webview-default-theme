import { makeStyles, tokens } from '@fluentui/react-components';
import { roleVar } from '../../theme/roles.ts';

/**
 * 选中底：前景色的 14% 叠在材质上，两档都比悬停显眼。不用 `colorSubtleBackgroundSelected`：深色档它比
 * 悬停底还暗，浅色档压在 Mica 上几乎看不出。
 */
const SELECTED_FILL = `color-mix(in oklab, ${tokens.colorNeutralForeground1} 14%, transparent)`;

/**
 * 侧边栏导航项的外观，改在 Fluent `NavItem` 上：固定项与播放列表节里的各张列表共用。
 *
 * Fluent 的缺省底是不透明的 `colorNeutralBackground4`，这里直接坐在窗口材质上，改成透明，悬停与按下
 * 叠加局部半透明状态层。高 32，比 Windows 11 缺省的 36–40 压低一档，好让播放列表节多露几张。
 * 图标照 20 原大画，左边留 10：展开态与图标态的项都从离窗口边 8 处起，图标落在同一处（中线离窗口边
 * 28，与标题栏的 ⋯ 对齐），换形态时不挪。
 * 选中是浅底加左侧 3px 竖条：竖条是每项自带的一根（样式在 SidebarItem.module.css），平时透明，
 * 选中时显出；换选中项时由 `useSelectionIndicator` 让旧、新两根一起播移动动画。Fluent 自己那根
 * 只会在新项上淡入，藏掉。这里只放改 Fluent 组件（NavItem 与它的图标槽）的样式，自己的元素用
 * CSS Modules。
 */
export const useSidebarItemStyles = makeStyles({
  item: {
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    height: '32px',
    padding: `0 ${tokens.spacingHorizontalM} 0 ${tokens.spacingHorizontalMNudge}`,
    color: tokens.colorNeutralForeground1,
    cursor: 'default',
    '@media (forced-colors: none)': {
      backgroundColor: 'transparent',
      '&:not([aria-disabled="true"])': {
        ':hover': { backgroundColor: roleVar('state-hover') },
        ':active': { backgroundColor: roleVar('state-pressed') },
      },
    },
    '::after': { display: 'none' },
  },
  selected: {
    '@media (forced-colors: none)': {
      backgroundImage: `linear-gradient(${SELECTED_FILL}, ${SELECTED_FILL})`,
    },
  },
  /** 页面还没上线：置灰，但不用 disabled，否则收不到指针，「即将推出」的提示弹不出来。 */
  soon: {
    color: tokens.colorNeutralForegroundDisabled,
    ':hover': { backgroundColor: 'transparent' },
    ':active': { backgroundColor: 'transparent' },
  },
  /** 锁定的列表照样能点开，只是读成「改不了」：文字与图标一起压暗。 */
  muted: { color: tokens.colorNeutralForeground3 },
  /** 图标态的一项 40 × 32，图标居中，与展开态左边留的 10 相同。 */
  compact: {
    justifyContent: 'center',
    width: '40px',
    padding: '0',
  },
  icon: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    minHeight: '20px',
    '& svg': { width: '20px', height: '20px' },
  },
});
