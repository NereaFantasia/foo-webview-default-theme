import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { MenuList } from '@fluentui/react-components';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useColumnChecklist } from './ColumnChecklist.tsx';
import type { ColumnsModel } from './columnsModel.ts';
import type { TablePoint } from '../tableItems.ts';

export interface ColumnMenuProps {
  /** 菜单的落点，视口坐标；null 时关着 */
  readonly at: TablePoint | null;
  readonly columns: ColumnsModel;
  /** 打开前拿着焦点的元素已经不在了（比如刚把那一列藏掉），关掉后焦点回到这里 */
  readonly root: RefObject<HTMLElement | null>;
  onClose(): void;
}

/**
 * 列头的右键菜单：只有列的勾选，与视图面板的「列」键是同一份清单（`useColumnChecklist`）。用 Esc 或菜单项关掉
 * 时，焦点交还打开前拿着它的那一处（列头格或表格），键盘接得上；点到菜单外面关掉时，焦点已经落在点的地方，
 * 不抢回来
 */
export function ColumnMenu({ at, columns, root, onClose }: ColumnMenuProps) {
  const checklist = useColumnChecklist(columns);
  const open = at !== null;
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);
  const target = useMemo(
    () => at && { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) },
    [at],
  );
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      open={open}
      onOpenChange={(_, data) => {
        if (data.open) return;
        onClose();
        // 焦点还在这份菜单里、或掉回 body 时才交还；已经落在别处的，是用户点过去的
        const active = document.activeElement;
        const unclaimed =
          active === document.body ||
          (active !== null && active.closest('[data-column-menu]') !== null);
        if (!unclaimed) return;
        const back = returnTo.current?.isConnected ? returnTo.current : root.current;
        back?.focus({ preventScroll: true });
      }}
      positioning={{ target, position: 'below', align: 'start' }}
      checkedValues={checklist.checkedValues}
      onCheckedValueChange={checklist.onCheckedValueChange}
    >
      <MenuPopover data-column-menu>
        <MenuList>{checklist.items}</MenuList>
      </MenuPopover>
    </Menu>
  );
}
