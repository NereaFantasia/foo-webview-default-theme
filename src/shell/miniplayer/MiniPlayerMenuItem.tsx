import { MenuItem } from '@fluentui/react-components';
import { PictureInPicture20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { miniWindowAtom, miniWindowKey } from '../../host/miniWindow.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';

/** 主菜单里进入迷你模式的一项；三种播放栏形态与停止时都从这里进。 */
export function MiniPlayerMenuItem() {
  const t = useAtomValueRawSync(translateAtom);
  const mini = useService(miniWindowKey);
  const { busy } = useAtomValueRawSync(miniWindowAtom);
  return (
    <MenuItem
      icon={<PictureInPicture20Regular />}
      disabled={busy}
      onClick={() => void mini.enter()}
    >
      {t('player.miniPlayer')}
    </MenuItem>
  );
}
