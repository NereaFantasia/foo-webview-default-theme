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
  ArrowShuffle20Regular,
  ArrowSwap20Regular,
  Crop20Regular,
  Edit20Regular,
  MoreHorizontal20Regular,
  SelectAllOn20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { MENU_SURFACE_MOTION } from '../motion/MenuMotion.tsx';
import { filterLabel } from '../track/filterLabels.ts';
import { autoplaylistEditKey } from './autoplaylistEdit.ts';
import { trackFilterOf } from './filter/playlistFilter.ts';
import type { ListMenuReorder } from './playlistListMenu.ts';
import { SEND_TO_INLINE_LIMIT } from './playlistTrackActions.ts';
import type { PlaylistPageModel } from './usePlaylistPage.ts';
import { useService } from '../kit/useService.ts';
import { playlistPageKey } from './playlistPageServices.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

export interface PlaylistMoreMenuProps {
  readonly guid: string;
  readonly model: Pick<PlaylistPageModel, 'entry' | 'rows' | 'filter' | 'selection' | 'latest'>;
  /** 随机与反向：重排宿主列表本身，锁定时置灰；列表不支持时不出 */
  readonly reorder?: ListMenuReorder;
}

/**
 * 页头标题行末尾的 ⋯。过滤时先是对命中的一批做事：全选命中（与表格上的 Ctrl+A 相同）、发送到新播放列表
 * 会改动列表的单成「改动列表」一节：随机、反向，以及过滤时的只保留命中（先让宿主选中命中的行再裁剪，移除其余的，
 * 可撤销）。命中到了上限、没找全时不许只保留命中：没找到的命中会一起删掉。按字段排序只在列头
 * 自动播放列表的内容与顺序由规则定，这一节整段换成「编辑自动播放列表」：排序在规则里改，列头也不可排序
 */
export function PlaylistMoreMenu({ guid, model, reorder }: PlaylistMoreMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const plural = useAtomValueRawSync(pluralAtom);
  const page = useService(playlistPageKey);
  const autoplaylistEdit = useService(autoplaylistEditKey);
  const { entry, rows, filter } = model;
  const autoplaylist = entry?.isAutoplaylist === true;
  if (!filter.active && !reorder && !autoplaylist) return null;
  const hits = filter.hits.length;
  const others = Math.max(0, rows.total - hits);
  const locked = entry?.isLocked ?? true;
  // 过滤态里能走到的行正是命中的那些
  const ranges = () => model.latest().reachable();
  const label = filterLabel(trackFilterOf(filter), t);
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
          {autoplaylist ? (
            <MenuItem
              icon={<Edit20Regular />}
              data-action="edit-autoplaylist"
              onClick={() => autoplaylistEdit.open(guid)}
            >
              {t('playlistPage.editAutoplaylist')}
            </MenuItem>
          ) : (
            <MenuGroup>
              <MenuGroupHeader>{t('playlistPage.changeList')}</MenuGroupHeader>
              {reorder && (
                <>
                  <MenuItem
                    icon={<ArrowShuffle20Regular />}
                    disabled={reorder.disabled}
                    data-action="shuffle"
                    onClick={reorder.shuffle}
                  >
                    {t('table.shuffle')}
                  </MenuItem>
                  <MenuItem
                    icon={<ArrowSwap20Regular />}
                    disabled={reorder.disabled}
                    data-action="reverse"
                    onClick={reorder.reverse}
                  >
                    {t('table.reverse')}
                  </MenuItem>
                </>
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
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
