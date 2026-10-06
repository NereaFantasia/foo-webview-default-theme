import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddSquare20Regular,
  Crop20Regular,
  MoreHorizontal20Regular,
  SelectAllOn20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { SEND_TO_INLINE_LIMIT } from '../playlistTrackActions.ts';
import type { PlaylistPageModel } from '../usePlaylistPage.ts';
import { useService } from '../../kit/useService.ts';
import { playlistPageKey } from '../playlistPageServices.ts';

export interface PlaylistHitsMenuProps {
  readonly guid: string;
  readonly model: Pick<PlaylistPageModel, 'entry' | 'rows' | 'filter' | 'selection' | 'latest'>;
}

/**
 * 过滤时页头的 ⋯：对命中的一批做事。全选命中（与表格上的 Ctrl+A 相同）、发送到新播放列表、只保留命中
 * （先让宿主选中命中的行再裁剪，移除其余的，可撤销）。只在过滤态出。命中到了上限、没找全时不许只保留命中：
 * 没找到的命中会一起删掉。
 */
export function PlaylistHitsMenu({ guid, model }: PlaylistHitsMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const page = useService(playlistPageKey);
  const { entry, rows, filter } = model;
  if (!filter.active) return null;
  const hits = filter.hits.length;
  const others = Math.max(0, rows.total - hits);
  const locked = entry?.isLocked ?? true;
  // 过滤态里能走到的行正是命中的那些。
  const ranges = () => model.latest().reachable();
  const label = [filter.term, ...filter.conditions.map((item) => item.value)]
    .filter((part) => part !== '')
    .join(' · ');
  const note = t(plural(others, 'playlistPage.keepHitsNoteOne', 'playlistPage.keepHitsNote'), {
    count: others,
  });
  return (
    <Menu surfaceMotion={MENU_SURFACE_MOTION}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t('playlistPage.hitsMenu')} relationship="label">
          <Button appearance="subtle" icon={<MoreHorizontal20Regular />} data-playlist-hits-menu />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('playlistPage.hitsMenu')}>
          <MenuItem
            icon={<SelectAllOn20Regular />}
            disabled={hits === 0}
            secondaryContent="Ctrl+A"
            data-action="select-hits"
            onClick={() => model.selection.replace(ranges())}
          >
            {t('playlistPage.selectHits')}
          </MenuItem>
          <MenuItem
            icon={<AddSquare20Regular />}
            disabled={hits === 0 || hits > SEND_TO_INLINE_LIMIT}
            data-action="send-hits"
            onClick={() => {
              const name = t('playlistPage.hitsListName', {
                name: entry?.name ?? '',
                filter: label,
              });
              void page.tracks.sendToNew(guid, ranges(), name);
            }}
          >
            {t('playlistPage.sendHits')}
          </MenuItem>
          <MenuItem
            icon={<Crop20Regular />}
            disabled={hits === 0 || others === 0 || filter.truncated || locked}
            secondaryContent={others > 0 ? note : undefined}
            data-action="keep-hits"
            onClick={() => {
              model.selection.replace(ranges());
              void page.tracks.crop(guid);
            }}
          >
            {t('playlistPage.keepHits')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
