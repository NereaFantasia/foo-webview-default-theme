import {
  PopoverSurface as FluentPopoverSurface,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { createContext, useContext, type ComponentProps, type CSSProperties } from 'react';
import { roleVar } from './roles.ts';
import { useMenuStyles } from './menuStyles.ts';

export const PanelBackgroundContext = createContext<string | undefined>(undefined);

const useStyles = makeStyles({
  surface: {
    '@media (forced-colors: none)': {
      backgroundColor: roleVar('bg-panel-overlay'),
      ...shorthands.borderColor(tokens.colorNeutralStrokeAlpha),
    },
  },
});

/** 浮层背景由主题根传入Portal；面板内的菜单与选项列表独立选择表面 */
export function PopoverSurface({
  className,
  style,
  ...props
}: ComponentProps<typeof FluentPopoverSurface>) {
  const classes = useStyles();
  const menu = useMenuStyles();
  const background = useContext(PanelBackgroundContext);
  const surfaceStyle: CSSProperties & { '--bg-panel-overlay'?: string } = { ...style };
  if (background) surfaceStyle['--bg-panel-overlay'] = background;
  return (
    <FluentPopoverSurface
      {...props}
      className={mergeClasses(className, classes.surface, menu.typography)}
      style={surfaceStyle}
    />
  );
}
