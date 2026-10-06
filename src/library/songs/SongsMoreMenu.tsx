import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddSquare20Regular,
  ArrowReset20Regular,
  Column20Regular,
  MoreHorizontal20Regular,
  Sparkle20Regular,
  TextDensity20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { columnDef, REQUIRED_COLUMN } from '../../table/columns/columns.ts';
import {
  isSongsDensity,
  songsPrefsAtom,
  SONGS_DENSITIES,
  type SongsDensity,
} from './songsPrefs.ts';
import type { SongsPageModel } from './useSongsPage.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';

const DENSITY_LABELS: Readonly<Record<SongsDensity, MessageKey>> = {
  compact: 'songs.densityCompact',
  standard: 'songs.densityStandard',
  comfortable: 'songs.densityComfortable',
};

/**
 * 页头右端的 ⋯：列的显隐、行的疏密、分面条开关、恢复默认的列与排序，以及对表格此刻全部结果的两样成批命令。
 * 成批命令按查询交给宿主，不传路径；结果是空的时置灰。
 */
export function SongsMoreMenu({ model }: { readonly model: SongsPageModel }) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(songsPrefsAtom);
  const songs = useService(songsKey);
  const { columns, run } = model;
  const { hidden } = useAtomValueRawSync(columns.state);
  const shown = columns.offered.filter((id) => !hidden.has(id));
  const usable = model.resultsCurrent && model.rows.handles.length > 0;
  const name = run.label ? t('songs.listName', { label: run.label }) : t('songs.title');

  return (
    <Menu
      surfaceMotion={MENU_SURFACE_MOTION}
      checkedValues={{ panels: prefs.facetsOpen ? ['facets'] : [] }}
      onCheckedValueChange={(_, data) => {
        if (data.name === 'panels') songs.prefs.setFacetsOpen(data.checkedItems.includes('facets'));
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t('songs.more')} relationship="label">
          <Button icon={<MoreHorizontal20Regular />} data-songs-more />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <Menu
            surfaceMotion={MENU_SURFACE_MOTION}
            checkedValues={{ columns: shown }}
            onCheckedValueChange={(_, data) => {
              for (const id of columns.offered) {
                columns.setHidden(id, !data.checkedItems.includes(id));
              }
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<Column20Regular />} data-action="columns">
                {t('songs.columns')}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {columns.offered.map((id) => (
                  <MenuItemCheckbox
                    key={id}
                    name="columns"
                    value={id}
                    disabled={id === REQUIRED_COLUMN}
                  >
                    {t(columnDef(id).label)}
                  </MenuItemCheckbox>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu
            surfaceMotion={MENU_SURFACE_MOTION}
            checkedValues={{ density: [prefs.density] }}
            onCheckedValueChange={(_, data) => {
              const [density] = data.checkedItems;
              if (isSongsDensity(density)) songs.prefs.setDensity(density);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<TextDensity20Regular />} data-action="density">
                {t('songs.density')}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {SONGS_DENSITIES.map((density) => (
                  <MenuItemRadio key={density} name="density" value={density}>
                    {t(DENSITY_LABELS[density])}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <MenuItemCheckbox name="panels" value="facets" data-action="facets">
            {t('songs.showFacets')}
          </MenuItemCheckbox>
          <MenuItem
            icon={<ArrowReset20Regular />}
            data-action="reset"
            onClick={() => {
              columns.reset();
              songs.prefs.resetSort();
            }}
          >
            {t('songs.resetView')}
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<Sparkle20Regular />}
            disabled={!usable}
            data-action="autoplaylist"
            onClick={() => void songs.actions.createAutoplaylist(run, name)}
          >
            {t('songs.createAutoplaylist')}
          </MenuItem>
          <MenuItem
            icon={<AddSquare20Regular />}
            disabled={!usable}
            data-action="send-to-new"
            onClick={() => void songs.actions.sendToNew(run, name)}
          >
            {t('songs.sendToNew')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
