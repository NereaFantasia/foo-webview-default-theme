import { useSearchSession } from '../library/search/searchContext.ts';
import { SearchInput } from '../library/search/SearchInput.tsx';
import { PlaylistFlyout } from '../playlist/sidebar/PlaylistFlyout.tsx';
import { SidebarPlaylists } from '../playlist/sidebar/SidebarPlaylists.tsx';
import { PAGES } from './pages.ts';
import type { ShellSlots } from '../shell/shellSlots.ts';

function useShowSearch(): () => void {
  const session = useSearchSession();
  return () => session.show();
}

/** 外壳的插槽由这里填：外壳不导入其他业务，页面与侧边栏里的业务件经它放进去。 */
export const SHELL_SLOTS: ShellSlots = {
  pages: PAGES,
  SidebarSearch: SearchInput,
  SidebarPlaylists,
  PlaylistFlyout,
  useShowSearch,
};
