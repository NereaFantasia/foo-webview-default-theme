import {
  Combobox,
  mergeClasses,
  resolvePositioningShorthand,
  type ComboboxProps,
} from '@fluentui/react-components';
import type { Ref } from 'react';
import { useMenuSurface } from '../theme/MenuSurface.tsx';
import { longListPositioning } from './context-menu/listPositioning.ts';
import { useScrollMenuBounds } from './context-menu/useScrollMenuBounds.ts';
import { useContextMenuStyles } from './context-menu/contextMenuStyles.ts';

export interface ScrollComboboxProps extends Omit<ComboboxProps, 'listbox'> {
  /** 选项列表的最大高度，CSS 像素；选项多的列表用它压住，不然会长到视口那么高 */
  readonly listboxMaxHeight?: number;
  /** 输入框元素，调用方量位置用 */
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * 可输入的下拉框：选项列表与 `ScrollDropdown` 一样，沿用对象菜单的浮层底色、视口边界与滚动样式，
 * 不用 Fluent 的缺省列表样式，宽度跟输入框一样。选项导航仍由 Fluent 管理。不做「盖住输入框」的定位：
 * 输入的文字要看得见
 */
export function ScrollCombobox({ listboxMaxHeight, inputRef, ...props }: ScrollComboboxProps) {
  const { bounds, boundaryPadding } = useScrollMenuBounds();
  const classes = useContextMenuStyles();
  const surface = useMenuSurface();
  return (
    <Combobox
      {...props}
      ref={inputRef}
      positioning={{
        overflowBoundaryPadding: boundaryPadding,
        ...longListPositioning(props.children),
        ...resolvePositioningShorthand(props.positioning),
      }}
      listbox={{
        className: mergeClasses(classes.list, surface.className),
        style: {
          ...surface.style,
          maxHeight: Math.min(bounds.height, listboxMaxHeight ?? bounds.height),
          maxWidth: bounds.width,
        },
      }}
    />
  );
}
