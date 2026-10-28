import {
  MenuPopover,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { createContext, useContext, type ComponentProps, type CSSProperties } from 'react';
import { roleVar } from './roles.ts';
import { SCROLLBAR_STYLES } from './scrollbarStyles.ts';
import { useMenuStyles } from './menuStyles.ts';

/** 实色背景通过组件树传递，局部封面主题和级联Portal都能取得 */
export const MenuBackgroundContext = createContext<string | undefined>(undefined);

const useStyles = makeStyles({
  surface: {
    ...SCROLLBAR_STYLES,
    '& *': SCROLLBAR_STYLES,
  },
  tinted: {
    '@media (forced-colors: none)': {
      ...shorthands.borderColor(tokens.colorNeutralStrokeAlpha),
      '--colorNeutralBackground1': roleVar('bg-menu'),
      '--colorNeutralBackground1Hover': `color-mix(in srgb, ${tokens.colorNeutralForeground1} 6%, ${roleVar('bg-menu')})`,
      '--colorNeutralBackground1Pressed': `color-mix(in srgb, ${tokens.colorNeutralForeground1} 4%, ${roleVar('bg-menu')})`,
      '--colorNeutralBackground1Selected': `color-mix(in srgb, ${tokens.colorNeutralForeground1} 6%, ${roleVar('bg-menu')})`,
    },
  },
});

/** 应用在菜单或选项列表节点；后代Tooltip和Dialog的Portal仍取自身主题 */
export function useMenuSurface() {
  const classes = useStyles();
  const menu = useMenuStyles();
  const background = useContext(MenuBackgroundContext);
  const style: CSSProperties & { '--bg-menu'?: string } = {};
  if (background) style['--bg-menu'] = background;
  return {
    className: mergeClasses(
      classes.surface,
      menu.typography,
      menu.items,
      background && classes.tinted,
    ),
    style,
  };
}

export function MenuSurface({
  className,
  style,
  children,
  ...props
}: ComponentProps<typeof MenuPopover>) {
  const surface = useMenuSurface();
  const classes = useMenuStyles();
  return (
    <MenuPopover
      {...props}
      className={mergeClasses(className, surface.className, classes.root)}
      style={{ ...style, ...surface.style }}
    >
      <div className={classes.backplate} data-menu-backplate aria-hidden />
      <div className={classes.viewport} data-menu-viewport>
        <div className={classes.content} data-menu-content>
          {children}
        </div>
      </div>
    </MenuPopover>
  );
}
