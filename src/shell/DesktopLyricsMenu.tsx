import {
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  MenuList,
  MenuTrigger,
} from '@fluentui/react-components';
import { Settings20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { MenuSurface } from '../kit/HostMenuList.tsx';
import { useService } from '../kit/useService.ts';
import { desktopLyricsKey } from '../lyrics/desktop/desktopLyrics.ts';
import { DESKTOP_LYRICS_ALIGNS } from '../lyrics/desktop/desktopLyricsPrefs.ts';
import { Menu } from '../motion/Surfaces.tsx';

/**
 * 桌面歌词的菜单：显示、锁定｜对齐三选一｜桌面歌词设置。播放栏的桌面歌词键右键打开它，标题栏 ⋯ 菜单里是
 * 同一份子菜单；触发件由调用方给
 */
export function DesktopLyricsMenu({
  children,
  openOnContext = false,
}: {
  readonly children: ReactElement;
  readonly openOnContext?: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(desktopLyricsKey);
  const { status } = useAtomValueRawSync(service.state);
  const { locked, align } = useAtomValueRawSync(service.pref);
  return (
    <Menu
      openOnContext={openOnContext}
      hasCheckmarks
      checkedValues={{
        show: status === 'closed' ? [] : ['show'],
        lock: locked ? ['lock'] : [],
        align: [align],
      }}
      onCheckedValueChange={(_, { name, checkedItems }) => {
        if (name === 'show') service.setOpen(checkedItems.includes('show'));
        else if (name === 'lock') service.setLocked(checkedItems.includes('lock'));
        else {
          const next = DESKTOP_LYRICS_ALIGNS.find((value) => checkedItems.includes(value));
          if (next) service.setAlign(next);
        }
      }}
    >
      <MenuTrigger disableButtonEnhancement>{children}</MenuTrigger>
      <MenuSurface>
        <MenuList>
          <MenuItemCheckbox name="show" value="show">
            {t('desktopLyrics.show')}
          </MenuItemCheckbox>
          <MenuItemCheckbox name="lock" value="lock">
            {t('desktopLyrics.lockItem')}
          </MenuItemCheckbox>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>{t('desktopLyrics.align')}</MenuGroupHeader>
            {DESKTOP_LYRICS_ALIGNS.map((value) => (
              <MenuItemRadio key={value} name="align" value={value}>
                {t(`desktopLyrics.align.${value}`)}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <MenuItem icon={<Settings20Regular />} onClick={service.openSettings}>
            {t('desktopLyrics.settings')}
          </MenuItem>
        </MenuList>
      </MenuSurface>
    </Menu>
  );
}
