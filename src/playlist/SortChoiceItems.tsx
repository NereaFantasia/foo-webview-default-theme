import { ScrollMenu as Menu, ScrollMenuPopover as MenuPopover } from '../kit/ScrollMenuPopover.tsx';
import { MenuDivider, MenuItem, MenuList, MenuTrigger } from '@fluentui/react-components';
import type { Translate } from '../i18n/translate.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import type { ListMenuSort } from './playlistListMenu.ts';

/**
 * 列表排序菜单项集合：提供各字段升降序二级子菜单，末尾附带随机乱序与倒序操作；禁用状态下全量置灰
 */
export function SortChoiceItems({
  sort,
  t,
}: {
  readonly sort: ListMenuSort;
  readonly t: Translate;
}) {
  return (
    <>
      {sort.choices.map((choice) => (
        <Menu key={choice.id} surfaceMotion={MENU_SURFACE_MOTION}>
          <MenuTrigger disableButtonEnhancement>
            <MenuItem disabled={sort.disabled} data-sort-choice={choice.id}>
              {t(choice.label)}
            </MenuItem>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem disabled={sort.disabled} onClick={() => sort.pick(choice.id, false)}>
                {t('query.ascending')}
              </MenuItem>
              <MenuItem disabled={sort.disabled} onClick={() => sort.pick(choice.id, true)}>
                {t('query.descending')}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      ))}
      {(sort.shuffle || sort.reverse) && <MenuDivider />}
      {sort.shuffle && (
        <MenuItem disabled={sort.disabled} onClick={() => sort.shuffle?.()}>
          {t('table.shuffle')}
        </MenuItem>
      )}
      {sort.reverse && (
        <MenuItem disabled={sort.disabled} onClick={() => sort.reverse?.()}>
          {t('table.reverse')}
        </MenuItem>
      )}
    </>
  );
}
