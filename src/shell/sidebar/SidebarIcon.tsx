import {
  Album20Regular,
  Clock20Regular,
  Folder20Regular,
  Grid20Regular,
  Guitar20Regular,
  Home20Regular,
  Mic20Regular,
  MusicNote120Regular,
  Settings20Regular,
} from '@fluentui/react-icons';
import type { SidebarItemId } from '../../nav/sidebar/sidebarNav.ts';

const ICONS = {
  home: Home20Regular,
  recent: Clock20Regular,
  artists: Mic20Regular,
  albums: Album20Regular,
  songs: MusicNote120Regular,
  genres: Guitar20Regular,
  folders: Folder20Regular,
  playlists: Grid20Regular,
  settings: Settings20Regular,
} as const satisfies Record<SidebarItemId, unknown>;

export interface SidebarIconProps {
  readonly id: SidebarItemId;
}

/** 侧边栏固定项的图标，展开态与图标态共用一套。 */
export function SidebarIcon({ id }: SidebarIconProps) {
  const Icon = ICONS[id];
  return <Icon />;
}
