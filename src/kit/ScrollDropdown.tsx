import {
  Dropdown,
  mergeClasses,
  resolvePositioningShorthand,
  type DropdownProps,
} from '@fluentui/react-components';
import { useMenuSurface } from '../theme/MenuSurface.tsx';
import { useContextMenuViewport } from './context-menu/useContextMenuViewport.ts';
import { contextMenuBounds } from './context-menu/contextMenuGeometry.ts';
import { useContextMenuStyles } from './context-menu/contextMenuStyles.ts';

/** 选项列表沿用对象菜单的视口边界和滚动样式；选项导航仍由 Fluent 管理 */
export function ScrollDropdown(props: Omit<DropdownProps, 'listbox'>) {
  const viewport = useContextMenuViewport();
  const bounds = contextMenuBounds(viewport, 12);
  const classes = useContextMenuStyles();
  const surface = useMenuSurface();
  return (
    <Dropdown
      {...props}
      positioning={{
        overflowBoundaryPadding: 12,
        shiftToCoverTarget: true,
        ...resolvePositioningShorthand(props.positioning),
      }}
      listbox={{
        className: mergeClasses(classes.list, surface.className),
        style: { ...surface.style, maxHeight: bounds.height, maxWidth: bounds.width },
      }}
    />
  );
}
