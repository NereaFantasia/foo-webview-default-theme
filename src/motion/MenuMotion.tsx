import {
  useMenuContext_unstable,
  type MenuProps,
  type PresenceComponentProps,
} from '@fluentui/react-components';
import { SurfacePresence } from './SurfacePresence.tsx';

/** 主菜单初始露出一半，子菜单约三分之一；关闭冻结展开形态后淡出 */
export function MenuMotion(props: PresenceComponentProps) {
  const submenu = useMenuContext_unstable((context) => context.isSubmenu);
  return <SurfacePresence {...props} kind={submenu ? 'submenu' : 'menu'} />;
}

export const MENU_SURFACE_MOTION: MenuProps['surfaceMotion'] = {
  children: (_, props) => <MenuMotion {...props} />,
};
