import {
  Dropdown,
  mergeClasses,
  resolvePositioningShorthand,
  type DropdownProps,
} from '@fluentui/react-components';
import { useMenuSurface } from '../theme/MenuSurface.tsx';
import { longListPositioning } from './context-menu/listPositioning.ts';
import { useScrollMenuBounds } from './context-menu/useScrollMenuBounds.ts';
import { useContextMenuStyles } from './context-menu/contextMenuStyles.ts';

/** 选项列表沿用对象菜单的视口边界和滚动样式；选项导航仍由 Fluent 管理 */
export function ScrollDropdown(props: Omit<DropdownProps, 'listbox'>) {
  const { bounds, boundaryPadding } = useScrollMenuBounds();
  const classes = useContextMenuStyles();
  const surface = useMenuSurface();
  // 选项多的列表不盖住触发控件、不挪位置，固定在它下面；其余沿用「盖住触发控件」的摆法
  const long = longListPositioning(props.children);
  return (
    <Dropdown
      {...props}
      positioning={{
        overflowBoundaryPadding: boundaryPadding,
        ...(long ?? { shiftToCoverTarget: true }),
        ...resolvePositioningShorthand(props.positioning),
      }}
      listbox={{
        className: mergeClasses(classes.list, surface.className),
        style: { ...surface.style, maxHeight: bounds.height, maxWidth: bounds.width },
      }}
    />
  );
}
