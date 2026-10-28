import {
  MenuItemCheckbox,
  type MenuCheckedValueChangeData,
  type MenuCheckedValueChangeEvent,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { columnDef, REQUIRED_COLUMN } from './columns.ts';
import type { ColumnsModel } from './columnsModel.ts';

const NAME = 'columns';

/**
 * 表格列可见性勾选菜单 hook
 * 列头右键菜单与视图设置面板共享；统一管理列显示隐藏状态、即时持久化同步及必选列（标题列）禁止取消勾选规则
 */
export function useColumnChecklist(columns: ColumnsModel) {
  const t = useAtomValueRawSync(translateAtom);
  const { hidden } = useAtomValueRawSync(columns.state);
  const shown = columns.offered.filter((id) => !hidden.has(id));
  return {
    checkedValues: { [NAME]: shown },
    onCheckedValueChange(_: MenuCheckedValueChangeEvent, data: MenuCheckedValueChangeData) {
      if (data.name !== NAME) return;
      for (const id of columns.offered) columns.setHidden(id, !data.checkedItems.includes(id));
    },
    items: columns.offered.map((id) => (
      <MenuItemCheckbox key={id} name={NAME} value={id} disabled={id === REQUIRED_COLUMN}>
        {t(columnDef(id).label)}
      </MenuItemCheckbox>
    )),
  };
}
