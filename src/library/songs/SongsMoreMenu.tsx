import { Button, MenuItem, MenuList, MenuTrigger, Tooltip } from '@fluentui/react-components';
import {
  AddSquare20Regular,
  MoreHorizontal20Regular,
  Sparkle20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import {
  ScrollMenu as Menu,
  ScrollMenuPopover as MenuPopover,
} from '../../kit/ScrollMenuPopover.tsx';
import { useService } from '../../kit/useService.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { AutoplaylistDialog } from '../../track/autoplaylist/AutoplaylistDialog.tsx';
import { autoplaylistInitial } from '../../track/autoplaylist/autoplaylistForm.ts';
import { playStatsAtom } from '../playStats.ts';
import { songsKey } from './songsServices.ts';
import type { SongsPageModel } from './useSongsPage.ts';

/**
 * 集合操作末尾的 ⋯：对表格此刻全部结果的两样成批命令。成批命令按查询交给宿主，不传路径；发送到新列表在结果是空的时置灰
 * 「按当前条件创建自动播放列表」先开对话框，预填此刻的查询与排序，确认后才创建；对话框自己数命中数、校验查询，
 * 所以结果是空的、查询有误时也能打开，进去改
 * 列、行密度这些显示设置在「显示设置」菜单里
 */
export function SongsMoreMenu({ model }: { readonly model: SongsPageModel }) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const songs = useService(songsKey);
  const { available } = useAtomValueRawSync(playStatsAtom);
  const [creating, setCreating] = useState(false);
  const { run } = model;
  const usable = model.resultsCurrent && model.rows.handles.length > 0;
  const name = run.label ? t('songs.listName', { label: run.label }) : t('songs.title');

  return (
    <>
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
              data-action="autoplaylist"
              onClick={() => setCreating(true)}
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
      {creating && (
        <AutoplaylistDialog
          mode="create"
          initial={autoplaylistInitial(name, run.fill)}
          playcountMissing={available === false}
          onSubmit={async (request) =>
            (await songs.actions.createAutoplaylist(request)) ? 'done' : 'failed'
          }
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
