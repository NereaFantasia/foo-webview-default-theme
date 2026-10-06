import {
  Menu,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import {
  ColumnMenuSections,
  extrasChecked,
  extrasCheckedChange,
  type ColumnMenuExtras,
} from './ColumnMenuExtras.tsx';
import { columnDef, REQUIRED_COLUMN } from './columns.ts';
import type { ColumnsModel } from './columnsModel.ts';
import type { TablePoint } from '../tableItems.ts';

export interface ColumnMenuProps {
  /** 菜单的落点，视口坐标；null 时关着。 */
  readonly at: TablePoint | null;
  readonly columns: ColumnsModel;
  /** 列勾选之外的几段，见 `ColumnMenuExtras`；不给时菜单只有列的勾选。 */
  readonly extras?: ColumnMenuExtras;
  /** 打开前拿着焦点的元素已经不在了（比如刚把那一列藏掉），关掉后焦点回到这里。 */
  readonly root: RefObject<HTMLElement | null>;
  onClose(): void;
}

const COLUMNS = 'columns';

/**
 * 列头的右键菜单：勾选这张表显示哪几列，改了立刻落盘。标题列勾不掉。调用方给了别的段（排序、分组）时，
 * 列的勾选收进「列」子菜单。用 Esc 或菜单项关掉时，焦点交还打开前拿着它的那一处（列头格或表格），键盘接得
 * 上；点到菜单外面关掉时，焦点已经落在点的地方，不抢回来。
 */
export function ColumnMenu({ at, columns, extras, root, onClose }: ColumnMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(columns.state);
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
  const shown = columns.offered.filter((id) => !state.hidden.has(id));
  const applyColumns = (checked: readonly string[]) => {
    for (const id of columns.offered) columns.setHidden(id, !checked.includes(id));
  };
  const columnItems = columns.offered.map((id) => (
    <MenuItemCheckbox key={id} name={COLUMNS} value={id} disabled={id === REQUIRED_COLUMN}>
      {t(columnDef(id).label)}
    </MenuItemCheckbox>
  ));
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      open={open}
      onOpenChange={(_, data) => {
        if (data.open) return;
        onClose();
        // 焦点还在这份菜单里、或掉回 body 时才交还；已经落在别处的，是用户点过去的。子菜单的浮层不在第一层
        // 的 DOM 里，所以各层浮层都带 data-column-menu，按它认。
        const active = document.activeElement;
        const unclaimed =
          active === document.body ||
          (active !== null && active.closest('[data-column-menu]') !== null);
        if (!unclaimed) return;
        const back = returnTo.current?.isConnected ? returnTo.current : root.current;
        back?.focus({ preventScroll: true });
      }}
      positioning={{ target, position: 'below', align: 'start' }}
      checkedValues={extras ? extrasChecked(extras) : { [COLUMNS]: shown }}
      onCheckedValueChange={(_, data) => {
        if (data.name === COLUMNS) applyColumns(data.checkedItems);
        else if (extras) extrasCheckedChange(extras, data.name, data.checkedItems);
      }}
    >
      <MenuPopover data-column-menu>
        <MenuList>
          {extras ? (
            <>
              <Menu
                surfaceMotion={MENU_SURFACE_MOTION}
                checkedValues={{ [COLUMNS]: shown }}
                onCheckedValueChange={(_, data) => applyColumns(data.checkedItems)}
              >
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem>{t('table.columnsSection')}</MenuItem>
                </MenuTrigger>
                <MenuPopover data-column-menu>
                  <MenuList>{columnItems}</MenuList>
                </MenuPopover>
              </Menu>
              <ColumnMenuSections extras={extras} t={t} />
            </>
          ) : (
            columnItems
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
