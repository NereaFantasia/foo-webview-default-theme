import { useCallback, useState } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { useService } from '../../../kit/useService.ts';
import { objectOpenerKey } from '../../../nav/objectOpener.ts';
import type { MusicAlbum, MusicArtist, MusicPlaylist } from '../../../server/musicObjects.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { objectTargetOf, type OnlineObjectTarget } from './OnlineObjectMenu.tsx';
import type { OnlineTileActions } from './OnlineTiles.tsx';
import { useOnlineObjectActions } from './useOnlineObjectActions.ts';

export interface OnlineTileMenu {
  readonly at: TablePoint;
  readonly target: OnlineObjectTarget;
}

/**
 * 管理在线图块（专辑、艺人、歌单）的交互动作：单击导航、悬停起播、右键与更多选项菜单
 * 维护弹出菜单坐标与目标引用，失败提示通过 `setNotice` 同步通知
 */
export function useOnlineTileActions(setNotice: (notice: MessageKey | null) => void) {
  const objects = useService(objectOpenerKey);
  const objectActions = useOnlineObjectActions(setNotice);
  const [menu, setMenu] = useState<OnlineTileMenu | null>(null);
  const tileActions = useCallback(
    (item: MusicAlbum | MusicArtist | MusicPlaylist): OnlineTileActions => {
      const target = objectTargetOf(item);
      return {
        onOpen: () => void objects.open({ kind: 'onlineList', list: target.list }),
        onMenu: (at) => setMenu({ at, target }),
        onPlay: () => {
          setNotice(null);
          void objectActions.run(target, null);
        },
      };
    },
    [objects, objectActions, setNotice],
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  return { tileActions, menu, closeMenu };
}
