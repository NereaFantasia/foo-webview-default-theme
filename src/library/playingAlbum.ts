import { atom, type Atom } from 'jotai/vanilla';
import { playbackAtom } from '../playback/playback.ts';
import { trackAlbumKeyOf, type AlbumKey } from '../host/libraryContract.ts';

/**
 * 装载着的曲目属于哪张专辑（暂停时照样算）；停止或没有专辑名时为 null。专辑艺术家的取法与宿主折叠
 * 专辑、过滤词的曲目级命中同一口径（见 `trackAlbumArtistOf`）。答的是字符串，播放进度每秒变也不惊动
 * 读它的组件。
 */
export const playingAlbumKeyAtom: Atom<AlbumKey | null> = atom((get) => {
  const { track, state } = get(playbackAtom);
  if (!track || state === 'stopped') return null;
  return trackAlbumKeyOf(track);
});

export const playbackPausedAtom: Atom<boolean> = atom(
  (get) => get(playbackAtom).state === 'paused',
);
