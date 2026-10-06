import {
  MenuDivider,
  MenuItem,
  MenuList,
  MenuTrigger,
  ToolbarButton,
  Tooltip,
} from '@fluentui/react-components';
import { Menu } from '../motion/Surfaces.tsx';
import { MoreHorizontal16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { HostMenuList, MenuSurface, menuCheckProps } from '../kit/HostMenuList.tsx';
import { mainMenuAtom, mainMenuKey } from './mainMenu.ts';
import type { MenuNode } from '../host/menuNodes.ts';
import { useService } from '../kit/useService.ts';
import { MiniPlayerMenuItem } from './miniplayer/MiniPlayerMenuItem.tsx';

export interface MainMenuButtonProps {
  className?: string;
}

/**
 * 标题栏的 ⋯：fb2k 主菜单的各个根收在这一个键里，默认隐藏的命令收进末尾的「更多」。
 * 每次打开都重读一次，先显示手上这份，新的到了再换，不挡着菜单打开。
 */
export function MainMenuButton({ className }: MainMenuButtonProps) {
  const t = useAtomValueRawSync(translateAtom);
  const menu = useAtomValueRawSync(mainMenuAtom);
  const mainMenu = useService(mainMenuKey);
  const run = (node: MenuNode) => void mainMenu.run(node);
  const empty = menu.roots.length === 0;
  const unreadable = empty && menu.failure === 'read';
  return (
    <Menu
      {...menuCheckProps(menu.roots)}
      onOpenChange={(_, data) => data.open && void mainMenu.refresh()}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t('menu.trigger')} relationship="label">
          <ToolbarButton
            className={className}
            icon={<MoreHorizontal16Regular />}
            disabled={menu.status !== 'connected'}
            data-menu="main"
          />
        </Tooltip>
      </MenuTrigger>
      <MenuSurface>
        <MenuList>
          <MiniPlayerMenuItem />
          <MenuDivider />
        </MenuList>
        {unreadable ? (
          <MenuList>
            <MenuItem disabled>{t('menu.readFailed')}</MenuItem>
            <MenuItem onClick={mainMenu.retry}>{t('menu.retry')}</MenuItem>
          </MenuList>
        ) : (
          <HostMenuList nodes={menu.roots} onRun={run}>
            {/* 根为空时给一条置灰的项，不弹空浮层：首读还没回来是「正在读取」，读到了空树才是「没有」。 */}
            {empty && (
              <MenuItem disabled>{t(menu.loaded ? 'menu.empty' : 'menu.loading')}</MenuItem>
            )}
            {menu.tucked.length > 0 && (
              <>
                <MenuDivider />
                <Menu {...menuCheckProps(menu.tucked)}>
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem>{t('menu.more')}</MenuItem>
                  </MenuTrigger>
                  <MenuSurface>
                    <HostMenuList nodes={menu.tucked} onRun={run} />
                  </MenuSurface>
                </Menu>
              </>
            )}
          </HostMenuList>
        )}
      </MenuSurface>
    </Menu>
  );
}
