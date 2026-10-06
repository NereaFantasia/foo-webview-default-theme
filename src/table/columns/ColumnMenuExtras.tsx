import {
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import type { MessageKey } from '../../i18n/en.ts';
import type { Translate } from '../../i18n/translate.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';

/** 列头菜单里的一档：排序依据或分组依据。 */
export interface ColumnMenuChoice {
  readonly id: string;
  readonly label: MessageKey;
}

/** 排序段：点一档就按它排一次。列表不记着当前按哪一档排，菜单里也不标。 */
export interface ColumnMenuSort {
  readonly choices: readonly ColumnMenuChoice[];
  pick(id: string): void;
  /** 打乱、反转；不给就不画。 */
  readonly shuffle?: () => void;
  readonly reverse?: () => void;
}

/** 分组段：开关、依据与全部折叠、全部展开。 */
export interface ColumnMenuGroups {
  readonly enabled: boolean;
  /** 当前依据的 id，在 `modes` 里。 */
  readonly mode: string;
  readonly modes: readonly ColumnMenuChoice[];
  /** 此刻有组可折叠、展开；分组关着或游程还没取到时为假，那两项置灰。 */
  readonly canCollapse: boolean;
  setEnabled(enabled: boolean): void;
  setMode(id: string): void;
  collapseAll(): void;
  expandAll(): void;
}

/**
 * 列勾选之外的几段，给了哪段画哪段。给了任何一段，列的勾选就收进「列」子菜单，次序是：列、排序，分隔，
 * 分组开关、分组依据、全部折叠、全部展开。
 */
export interface ColumnMenuExtras {
  readonly sort?: ColumnMenuSort;
  readonly groups?: ColumnMenuGroups;
}

/** 分组开关这一项勾选的名与值：它挂在菜单第一层，勾选状态由第一层的 `Menu` 管。 */
const GROUPING = 'grouping';
const ON = 'on';
const GROUP_MODE = 'groupMode';

/** 第一层 `Menu` 的勾选状态：只有分组开关一项。 */
export function extrasChecked(extras: ColumnMenuExtras): Record<string, string[]> {
  return extras.groups ? { [GROUPING]: extras.groups.enabled ? [ON] : [] } : {};
}

/** 第一层 `Menu` 的勾选变了：是分组开关就交给调用方。 */
export function extrasCheckedChange(
  extras: ColumnMenuExtras,
  name: string,
  checked: readonly string[],
): void {
  if (name === GROUPING) extras.groups?.setEnabled(checked.includes(ON));
}

interface ColumnMenuSectionsProps {
  readonly extras: ColumnMenuExtras;
  readonly t: Translate;
}

/** 「列」子菜单之后的几段，画在菜单第一层。命令项点了就关菜单，分组开关勾了不关。 */
export function ColumnMenuSections({ extras, t }: ColumnMenuSectionsProps) {
  const { sort, groups } = extras;
  return (
    <>
      {sort && (
        <Menu surfaceMotion={MENU_SURFACE_MOTION}>
          <MenuTrigger disableButtonEnhancement>
            <MenuItem>{t('table.sortSection')}</MenuItem>
          </MenuTrigger>
          <MenuPopover data-column-menu>
            <MenuList>
              {sort.choices.map((choice) => (
                <MenuItem
                  key={choice.id}
                  data-sort-choice={choice.id}
                  onClick={() => sort.pick(choice.id)}
                >
                  {t(choice.label)}
                </MenuItem>
              ))}
              {(sort.shuffle || sort.reverse) && <MenuDivider />}
              {sort.shuffle && (
                <MenuItem onClick={() => sort.shuffle?.()}>{t('table.shuffle')}</MenuItem>
              )}
              {sort.reverse && (
                <MenuItem onClick={() => sort.reverse?.()}>{t('table.reverse')}</MenuItem>
              )}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
      {groups && (
        <>
          <MenuDivider />
          <MenuItemCheckbox name={GROUPING} value={ON}>
            {t('table.grouping')}
          </MenuItemCheckbox>
          <Menu
            surfaceMotion={MENU_SURFACE_MOTION}
            checkedValues={{ [GROUP_MODE]: [groups.mode] }}
            onCheckedValueChange={(_, data) => {
              const id = data.checkedItems[0];
              if (id !== undefined && id !== groups.mode) groups.setMode(id);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem disabled={!groups.enabled}>{t('table.groupBy')}</MenuItem>
            </MenuTrigger>
            <MenuPopover data-column-menu>
              <MenuList>
                {groups.modes.map((mode) => (
                  <MenuItemRadio key={mode.id} name={GROUP_MODE} value={mode.id}>
                    {t(mode.label)}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <MenuItem disabled={!groups.canCollapse} onClick={() => groups.collapseAll()}>
            {t('table.collapseAll')}
          </MenuItem>
          <MenuItem disabled={!groups.canCollapse} onClick={() => groups.expandAll()}>
            {t('table.expandAll')}
          </MenuItem>
        </>
      )}
    </>
  );
}
