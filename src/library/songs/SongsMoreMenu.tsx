import { Button, MenuItem, MenuList, MenuTrigger, Tooltip } from '@fluentui/react-components';
import {
  AddSquare20Regular,
  MoreHorizontal20Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { useService } from '../../kit/useService.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { songsKey } from './songsServices.ts';
import type { SongsPageModel } from './useSongsPage.ts';

/**
 * 集合操作末尾的 ⋯：对表格此刻全部结果的两样成批命令。成批命令按查询交给宿主，不传路径；结果是空的时置灰
 * 列、行密度这些显示设置在「显示设置」菜单里
 */
export function SongsMoreMenu({ model }: { readonly model: SongsPageModel }) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const songs = useService(songsKey);
  const { run } = model;
  const usable = model.resultsCurrent && model.rows.handles.length > 0;
  const name = run.label ? t('songs.listName', { label: run.label }) : t('songs.title');

  return (
    <Menu surfaceMotion={MENU_SURFACE_MOTION}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t('songs.more')} relationship="label">
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={<MoreHorizontal20Regular />}
            data-songs-more
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
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
