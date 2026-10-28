import { MenuSurface as MenuPopover } from '../theme/MenuSurface.tsx';
import {
  mergeClasses,
  resolvePositioningShorthand,
  type MenuProps,
  type MenuPopoverProps,
} from '@fluentui/react-components';
import { Menu } from '../motion/Surfaces.tsx';
import { useLayoutEffect, useRef } from 'react';
import { useContextMenuViewport } from './context-menu/useContextMenuViewport.ts';
import { contextMenuBounds } from './context-menu/contextMenuGeometry.ts';
import { useContextMenuStyles } from './context-menu/contextMenuStyles.ts';
import { pageContextMenu, revealContextMenuItem } from './context-menu/contextMenuKeyboard.ts';

/** 空间不足时允许菜单移过锚点，与对象菜单使用相同的视口留边 */
export function ScrollMenu({ positioning, ...props }: MenuProps) {
  return (
    <Menu
      {...props}
      positioning={{
        overflowBoundaryPadding: 12,
        shiftToCoverTarget: true,
        ...resolvePositioningShorthand(positioning),
      }}
    />
  );
}

/** 与对象菜单共用可用区域和命令区滚动，长菜单不推动页面 */
export function ScrollMenuPopover({ children, className, style, ...props }: MenuPopoverProps) {
  const viewport = useContextMenuViewport();
  const classes = useContextMenuStyles();
  const list = useRef<HTMLDivElement>(null);
  const bounds = contextMenuBounds(viewport, 12);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (list.current && active instanceof HTMLElement && list.current.contains(active))
      revealContextMenuItem(list.current, active);
  }, [bounds.height, bounds.width]);
  return (
    <MenuPopover
      {...props}
      className={mergeClasses(classes.surface, className)}
      style={{ ...style, maxWidth: bounds.width, maxHeight: bounds.height }}
      data-scroll-menu
    >
      <div
        ref={list}
        className={classes.list}
        data-scroll-menu-list
        onKeyDownCapture={pageContextMenu}
        onFocusCapture={(event) => {
          const item = event.target.closest<HTMLElement>('[role^="menuitem"]');
          if (item && list.current?.contains(item)) revealContextMenuItem(list.current, item);
        }}
      >
        {children}
      </div>
    </MenuPopover>
  );
}
