import {
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  type PositioningVirtualElement,
} from '@fluentui/react-components';
import { Dialog, Menu } from '../../motion/Surfaces.tsx';
import {
  Add20Regular,
  Broom20Regular,
  Copy20Regular,
  Delete20Regular,
  FolderOpen20Regular,
  LinkDismiss20Regular,
  List20Regular,
  Play20Regular,
  Rename20Regular,
  Save20Regular,
  SaveMultiple20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { playlistsAtom } from '../../playback/playlists.ts';
import { useService } from '../../kit/useService.ts';
import { playlistActionsKey } from '../playlistActions.ts';

/** 右键落在哪、针对哪一张（GUID）；落在清单空白处时 `guid` 为 null。 */
export interface PlaylistMenuTarget {
  readonly guid: string | null;
  readonly x: number;
  readonly y: number;
  /** 菜单关掉后焦点回到这里：没有触发键，Fluent 不会自己交还。 */
  readonly returnFocus: HTMLElement | null;
}

export interface PlaylistMenuProps {
  readonly target: PlaylistMenuTarget | null;
  onClose(): void;
  /** 要改名的那一张；编辑态由清单那边画。 */
  onRename(guid: string): void;
  /** 新建一张，与节里的「新建」是同一件事：清单那边先出一行输入名字，名字定了再建。 */
  onCreate(): void;
}

interface Confirming {
  readonly guid: string;
  readonly name: string;
  readonly count: number;
  readonly returnFocus: HTMLElement | null;
}

function pointAt(x: number, y: number): PositioningVirtualElement {
  return { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
}

/**
 * 播放列表节的右键菜单与删除前的确认。菜单针对右键落在的那一张，不切换活动列表：右键一张列表本没打算
 * 去那里。落在清单空白处时换成新建、载入、保存全部三项。
 *
 * 改内容的几项按锁置灰；只作用于活动列表的几项在别的列表上置灰，并提示先切过去。「转为普通列表」
 * 只在智能列表上出现。删除非空列表先确认：宿主没有回收站，删了就没了；空列表直接删。
 *
 * 目标按 GUID 记：菜单开着时那张被删了，菜单直接收起；确认框开着时被删了，确认也不会删到别的列表上。
 */
export function PlaylistMenu({ target, onClose, onRename, onCreate }: PlaylistMenuProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const { items, activeGuid } = useAtomValueRawSync(playlistsAtom);
  const actions = useService(playlistActionsKey);
  const [confirming, setConfirming] = useState<Confirming>();
  const entry = target?.guid ? items.find((item) => item.guid === target.guid) : undefined;
  const gone = target !== null && target.guid !== null && entry === undefined;
  const locked = entry?.isLocked ?? false;
  const inactive = entry !== undefined && entry.guid !== activeGuid;
  const activeHint = inactive ? t('playlist.activeOnly') : undefined;

  /** 先把焦点交还，再跑动作：动作可能弹宿主的对话框，焦点得先落回原处。 */
  const run = (action: () => unknown) => () => {
    target?.returnFocus?.focus();
    void action();
  };
  const remove = (guid: string, name: string, count: number) => {
    if (count > 0) setConfirming({ guid, name, count, returnFocus: target?.returnFocus ?? null });
    else void actions.remove(guid);
  };
  // 对话框关掉时焦点回到右键的那一行：菜单先关、对话框后开，Fluent 记下的是菜单那一刻的焦点。
  const closeConfirm = (confirmed: boolean) => {
    if (confirmed && confirming) void actions.remove(confirming.guid);
    confirming?.returnFocus?.focus();
    setConfirming(undefined);
  };

  return (
    <>
      <Menu
        open={target !== null && !gone}
        onOpenChange={(_, data) => {
          if (data.open) return;
          onClose();
          if (document.activeElement === document.body) target?.returnFocus?.focus();
        }}
        positioning={{
          target: pointAt(target?.x ?? 0, target?.y ?? 0),
          position: 'below',
          align: 'start',
        }}
      >
        <MenuPopover onContextMenu={(event) => event.preventDefault()}>
          <MenuList aria-label={t('playlist.menu')}>
            {entry ? (
              <>
                <MenuItem
                  icon={<Play20Regular />}
                  disabled={entry.trackCount === 0}
                  onClick={run(() => actions.play(entry.guid))}
                >
                  {t('playlist.play')}
                </MenuItem>
                <MenuItem icon={<Add20Regular />} onClick={run(onCreate)}>
                  {t('playlist.create')}
                </MenuItem>
                <MenuItem icon={<Rename20Regular />} onClick={run(() => onRename(entry.guid))}>
                  {t('playlist.rename')}
                </MenuItem>
                <MenuItem
                  icon={<Copy20Regular />}
                  onClick={run(() => actions.duplicate(entry.guid))}
                >
                  {t('playlist.duplicate')}
                </MenuItem>
                <MenuItem
                  icon={<Delete20Regular />}
                  onClick={run(() => remove(entry.guid, entry.name, entry.trackCount))}
                >
                  {t('playlist.remove')}
                </MenuItem>
                <MenuItem
                  icon={<Broom20Regular />}
                  disabled={locked}
                  onClick={run(() => actions.clear(entry.guid))}
                >
                  {t('playlist.clear')}
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  disabled={locked || inactive}
                  title={activeHint}
                  onClick={run(() => actions.removeDuplicates(entry.guid))}
                >
                  {t('playlist.removeDuplicates')}
                </MenuItem>
                <MenuItem
                  icon={<LinkDismiss20Regular />}
                  disabled={locked || inactive}
                  title={activeHint}
                  onClick={run(() => actions.removeDeadEntries(entry.guid))}
                >
                  {t('playlist.removeDeadEntries')}
                </MenuItem>
                <MenuItem
                  icon={<Save20Regular />}
                  disabled={inactive}
                  title={activeHint}
                  onClick={run(() => actions.savePlaylist(entry.guid))}
                >
                  {t('playlist.save')}
                </MenuItem>
                {entry.isAutoplaylist && (
                  <MenuItem
                    icon={<List20Regular />}
                    onClick={run(() => actions.convertToPlain(entry.guid))}
                  >
                    {t('playlist.convertToPlain')}
                  </MenuItem>
                )}
              </>
            ) : (
              <>
                <MenuItem icon={<Add20Regular />} onClick={run(onCreate)}>
                  {t('playlist.create')}
                </MenuItem>
                <MenuItem icon={<FolderOpen20Regular />} onClick={run(actions.loadPlaylist)}>
                  {t('playlist.load')}
                </MenuItem>
                <MenuItem icon={<SaveMultiple20Regular />} onClick={run(actions.saveAllPlaylists)}>
                  {t('playlist.saveAll')}
                </MenuItem>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      <Dialog
        open={confirming !== undefined}
        modalType="alert"
        onOpenChange={(_, data) => {
          if (!data.open) closeConfirm(false);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('playlist.removeTitle')}</DialogTitle>
            <DialogContent>
              {t(
                plural(
                  confirming?.count ?? 0,
                  'playlist.removeMessageOne',
                  'playlist.removeMessage',
                ),
                {
                  name: confirming?.name ?? '',
                  count: confirming?.count ?? 0,
                },
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => closeConfirm(true)}>
                {t('playlist.removeConfirm')}
              </Button>
              <Button onClick={() => closeConfirm(false)}>{t('common.cancel')}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
