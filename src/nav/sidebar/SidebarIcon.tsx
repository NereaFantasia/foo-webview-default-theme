import {
  Clock20Regular,
  Folder20Regular,
  Grid20Regular,
  Guitar20Regular,
  Home20Regular,
  Library20Regular,
  Mic20Regular,
  MusicNote120Regular,
  Settings20Regular,
  Video20Regular,
} from '@fluentui/react-icons';
import type { SidebarItemId } from './sidebarNav.ts';

const ICONS = {
  home: Home20Regular,
  recent: Clock20Regular,
  artists: Mic20Regular,
  albums: Library20Regular,
  songs: MusicNote120Regular,
  genres: Guitar20Regular,
  folders: Folder20Regular,
  video: Video20Regular,
  playlists: Grid20Regular,
  settings: Settings20Regular,
} as const satisfies Record<SidebarItemId, unknown>;

export interface SidebarIconProps {
  readonly id: SidebarItemId;
}

/** 侧边栏固定项的图标，展开态与图标态共用一套；设置里「启动时打开」的各项也取这一套 */
export function SidebarIcon({ id }: SidebarIconProps) {
  const Icon = ICONS[id];
  return <Icon />;
}
