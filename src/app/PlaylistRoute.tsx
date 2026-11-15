import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { useService } from '../kit/useService.ts';
import { albumListKey } from '../library/album-list/albumList.ts';
import { playStatsAtom } from '../library/playStats.ts';
import { albumArtwork } from '../library/SongArt.tsx';
import type { PageProps } from '../nav/places.ts';
import { PlaylistPage } from '../playlist/PlaylistPage.tsx';

/**
 * 播放列表路由入口：注入顶层封面服务以渲染未分组行的专辑缩略图，并告知 foo_playcount 装没装（筛选预设里
 * 播放与加入时间那一节要它），避免 playlist/ 反向依赖 library/
 */
export function PlaylistRoute(props: PageProps) {
  const albumList = useService(albumListKey);
  const { available } = useAtomValueRawSync(playStatsAtom);
  useEffect(() => void albumList.stats.probe(), [albumList]);
  return <PlaylistPage {...props} artwork={albumArtwork} playcount={available} />;
}
