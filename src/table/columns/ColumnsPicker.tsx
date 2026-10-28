import { MenuList, MenuTrigger, makeStyles } from '@fluentui/react-components';
import { ChevronRight16Regular, Column20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { ViewPanelButton } from '../../kit/ViewPanel.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useColumnChecklist } from './ColumnChecklist.tsx';
import type { ColumnsModel } from './columnsModel.ts';

const useStyles = makeStyles({ label: { flex: 1, textAlign: 'start' } });

/**
 * 视图面板里的「列」键：勾选表格显示哪几列，清单与列头右键菜单是同一份（`useColumnChecklist`）。勾选单画在
 * 面板里面，焦点不会跑出面板
 */
export function ColumnsPicker({ columns }: { readonly columns: ColumnsModel }) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const checklist = useColumnChecklist(columns);
  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      inline
      positioning="after-top"
      checkedValues={checklist.checkedValues}
      onCheckedValueChange={checklist.onCheckedValueChange}
    >
      <MenuTrigger disableButtonEnhancement>
        <ViewPanelButton icon={<Column20Regular />} data-action="columns">
          <span className={classes.label}>{t('query.columns')}</span>
          <ChevronRight16Regular />
        </ViewPanelButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('query.columns')}>{checklist.items}</MenuList>
      </MenuPopover>
    </Menu>
  );
}
