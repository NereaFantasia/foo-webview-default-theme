import { Menu } from '../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../theme/MenuSurface.tsx';
import {
  Button,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuTrigger,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddSquare20Regular,
  ArrowSort20Regular,
  Crop20Regular,
  MoreHorizontal20Regular,
  SelectAllOn20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import { SortChoiceItems } from './SortChoiceItems.tsx';
import type { ListMenuSort } from './playlistListMenu.ts';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';
import type { PlaylistPageModel } from './usePlaylistPage.ts';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

export interface PlaylistMoreMenuProps {
  readonly guid: string;
  readonly model: Pick<PlaylistPageModel, 'entry' | 'rows' | 'filter' | 'selection' | 'latest'>;
  /** 列表排序：重排宿主列表本身，锁定时置灰；列表不支持时不出 */
  readonly sort?: ListMenuSort;
}

/**
 * 页头标题行末尾的 ⋯。过滤时先是对命中的一批做事：全选命中（与表格上的 Ctrl+A 相同）、发送到新播放列表
 * 会改动列表的单成「改动列表」一节：列表排序，以及过滤时的只保留命中（先让宿主选中命中的行再裁剪，移除其余的，
 * 可撤销）。命中到了上限、没找全时不许只保留命中：没找到的命中会一起删掉
 */
export function PlaylistMoreMenu({ guid, model, sort }: PlaylistMoreMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const plural = useAtomValueRawSync(pluralAtom);
  const page = useService(playlistPageKey);
  const { entry, rows, filter } = model;
  if (!filter.active && !sort) return null;
  const hits = filter.hits.length;
  const others = Math.max(0, rows.total - hits);
  const locked = entry?.isLocked ?? true;
  // 过滤态里能走到的行正是命中的那些
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
        <Tooltip content={t('playlistPage.more')} relationship="label">
          <Button
            appearance="subtle"
            className={controls.icon}
            icon={<MoreHorizontal20Regular />}
            data-playlist-more
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('playlistPage.more')}>
          {filter.active && (
            <>
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
              <MenuDivider />
            </>
          )}
          <MenuGroup>
            <MenuGroupHeader>{t('playlistPage.changeList')}</MenuGroupHeader>
            {sort && (
              <Menu surfaceMotion={MENU_SURFACE_MOTION}>
                <MenuTrigger disableButtonEnhancement>
                  <MenuItem icon={<ArrowSort20Regular />} data-playlist-sort>
                    {t('playlistPage.listSort')}
                  </MenuItem>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList aria-label={t('playlistPage.listSort')}>
                    <SortChoiceItems sort={sort} t={t} />
                  </MenuList>
                </MenuPopover>
              </Menu>
            )}
            {filter.active && (
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
            )}
          </MenuGroup>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
