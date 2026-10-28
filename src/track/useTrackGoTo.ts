import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { useObjectOpener } from '../nav/ObjectLink.tsx';
import type { ObjectRef } from '../nav/objectRef.ts';
import { trackOrigin } from '../host/trackOrigin.ts';
import { onlineTracksAtom } from '../playback/onlineTracks.ts';
import { trackLinks, type LinkableTrack, type LinkedName, type TrackLinks } from './trackLinks.ts';
import type { GoToTarget, TrackMenuGoTo } from './trackMenuEntries.ts';

/**
 * 计算曲目右键菜单「转到」子菜单的目标集合
 * 基于曲目关联的专辑与艺人引用计算实时可达性；before 为跳转前钩子（如退出迷你窗口、暂存搜索词），仅在目标可达时执行；noAlbum 用于指定专辑不可达时的禁用原因多语言键
 */
export function useLinkedGoTo(
  links: TrackLinks | null,
  before?: (ref: ObjectRef) => void,
  noAlbum?: MessageKey,
): TrackMenuGoTo | null {
  const opener = useObjectOpener();
  if (!links) return null;
  const target = ({ text, ref }: LinkedName, unavailable?: MessageKey): GoToTarget => {
    const ready = ref !== null && opener.availability(ref) === 'ready';
    return {
      name: text,
      open: ready
        ? () => {
            before?.(ref);
            void opener.open(ref);
          }
        : null,
      here: ready && opener.isHere(ref),
      ...(unavailable ? { unavailable } : {}),
    };
  };
  return {
    album: links.album && target(links.album, noAlbum),
    artists: links.artists.map((artist) => target(artist)),
  };
}

/** 解析目标曲目在「转到」子菜单中的关联入口；支持媒体库本地曲目与已缓存元数据的在线曲目 */
export function useTrackGoTo(
  anchor: LinkableTrack | null,
  before?: (ref: ObjectRef) => void,
): TrackMenuGoTo | null {
  const online = useAtomValueRawSync(onlineTracksAtom);
  const isOnline = anchor?.path !== undefined && trackOrigin(anchor.path) === 'online';
  return useLinkedGoTo(
    anchor && trackLinks(anchor, online),
    before,
    isOnline ? 'trackMenu.noAlbumPage' : undefined,
  );
}
