import type { PageProps } from '../nav/places.ts';
import { albumArtwork } from '../library/SongArt.tsx';
import { PlaylistPage } from '../playlist/PlaylistPage.tsx';

/** 播放列表路由入口：注入顶层封面服务以渲染未分组行的专辑缩略图，避免 playlist/ 反向依赖 library/ */
export function PlaylistRoute(props: PageProps) {
  return <PlaylistPage {...props} artwork={albumArtwork} />;
}
