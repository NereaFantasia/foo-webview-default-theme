import {
  Button,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
} from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { ChevronUpDown20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { DIMENSION_LABELS } from '../albums/AlbumPageTools.tsx';
import { SECTION_DIMENSIONS } from '../albumSections.ts';
import { browserPrefsAtom } from '../albums/browserPrefs.ts';
import { listPrefsAtom } from './listPrefs.ts';
import { SECTION_ORDERS } from './listSort.ts';
import { useService } from '../../kit/useService.ts';
import { albumListKey } from './albumList.ts';
import { albumsKey } from '../albumServices.ts';

// 列表形态页头的两件：展开 / 折叠键、分节（依据与节的顺序）。排序在 ListSortMenu.tsx。

function pick<T extends string>(values: readonly T[], checked: readonly string[]): T | undefined {
  return values.find((value) => checked.includes(value));
}

/** 页头的展开 / 折叠键：全部展开、只展开节、专辑全折叠、全部折叠。 */
export function ListExpandMenu() {
  const t = useAtomValueRawSync(translateAtom);
  const { dimension } = useAtomValueRawSync(browserPrefsAtom);
  const albumList = useService(albumListKey);
  const sectioned = dimension !== 'album';
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t('albumList.expand')} relationship="label">
          <Button appearance="subtle" icon={<ChevronUpDown20Regular />} data-album-tool="expand" />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem data-action="expand-all" onClick={() => albumList.batch('expandAll')}>
            {t('albumList.expandAll')}
          </MenuItem>
          {sectioned && (
            <MenuItem data-action="only-sections" onClick={() => albumList.batch('onlySections')}>
              {t('albumList.onlySections', { dimension: t(DIMENSION_LABELS[dimension]) })}
            </MenuItem>
          )}
          <MenuItem data-action="collapse-albums" onClick={() => albumList.batch('collapseAlbums')}>
            {t('albumList.collapseAlbums')}
          </MenuItem>
          {sectioned && (
            <MenuItem data-action="collapse-all" onClick={() => albumList.batch('collapseAll')}>
              {t('albumList.collapseAll')}
            </MenuItem>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** 分节：依据与封面墙共用，节的顺序列表形态自己记。 */
export function ListDimensionMenu() {
  const t = useAtomValueRawSync(translateAtom);
  const { dimension } = useAtomValueRawSync(browserPrefsAtom);
  const { sectionOrder } = useAtomValueRawSync(listPrefsAtom);
  const albums = useService(albumsKey);
  const albumList = useService(albumListKey);
  return (
    <Menu
      checkedValues={{ dimension: [dimension], order: [sectionOrder] }}
      onCheckedValueChange={(_, data) => {
        if (data.name === 'dimension') {
          const next = pick(SECTION_DIMENSIONS, data.checkedItems);
          if (next) albums.prefs.setDimension(next);
        } else {
          const next = pick(SECTION_ORDERS, data.checkedItems);
          if (next) albumList.prefs.setSectionOrder(next);
        }
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuButton data-album-tool="dimension">
          {t('album.dimensionValue', { value: t(DIMENSION_LABELS[dimension]) })}
        </MenuButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('album.dimension')}>
          <MenuGroup>
            <MenuGroupHeader>
              {t('albumList.dimensionShared')}
              <br />
              {t('albumList.dimensionScope')}
            </MenuGroupHeader>
            {SECTION_DIMENSIONS.map((value) => (
              <MenuItemRadio key={value} name="dimension" value={value}>
                {t(DIMENSION_LABELS[value])}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>{t('albumList.sectionOrder')}</MenuGroupHeader>
            <MenuItemRadio name="order" value="name" disabled={dimension === 'album'}>
              {t('albumList.orderName')}
            </MenuItemRadio>
            <MenuItemRadio
              name="order"
              value="count"
              disabled={dimension === 'album'}
              secondaryContent={t('albumList.orderCountHint')}
            >
              {t('albumList.orderCount')}
            </MenuItemRadio>
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
