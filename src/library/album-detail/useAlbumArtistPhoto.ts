import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { settle } from '../../host/hostCall.ts';
import { useAlbumArtistPhotoService } from './albumArtistPhotoContext.ts';

/** 内存 LRU 缓存：曲目路径映射至艺人照片地址，未解析或无图记录为 null，避免页面进出重复查询 */
const PHOTOS = new Map<string, string | null>();
const LIMIT = 64;
/** 没有头像服务时读的恒空原子 */
const NO_PHOTO = atom<string | null>(null);

/**
 * 宿主按专辑首轨所在文件夹给的艺人图（`artist.jpg` 一类）
 * 宿主仅拼接地址而不预检物理存在，加载失败由头像组件展示占位，不回退专辑封面
 */
function useFolderArtistPhoto(path: string | undefined): string | null {
  const [photo, setPhoto] = useState<{ readonly path: string; readonly url: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!path) return;
    if (PHOTOS.has(path)) return;
    let current = true;
    void settle(() => fb.artwork.getFb2kUrlByPath(path, 'artist', { maxSize: 128 })).then(
      (answer) => {
        const url = answer && answer.success !== false && answer.dataUrl ? answer.dataUrl : null;
        PHOTOS.set(path, url);
        if (PHOTOS.size > LIMIT) {
          const oldest = PHOTOS.keys().next().value;
          if (oldest !== undefined) PHOTOS.delete(oldest);
        }
        if (current) setPhoto({ path, url });
      },
    );
    return () => {
      current = false;
    };
  }, [path]);
  if (!path) return null;
  return PHOTOS.get(path) ?? (photo?.path === path ? photo.url : null);
}

/**
 * 专辑详情页头的艺人头像地址。先用在线来源的艺术照（跟着用户选的 Apple Music 或 Last.fm，与艺人页同一套
 * 认定与缓存），在线没有或还没到时用宿主按专辑文件夹给的艺人图，都没有就是 null，由头像组件画占位。
 * `artist` 是专辑艺人名，`path` 是专辑首轨路径
 */
export function useAlbumArtistPhoto(artist: string, path: string | undefined): string | null {
  const service = useAlbumArtistPhotoService();
  useEffect(() => service?.show(artist), [service, artist]);
  const online = useAtomValueRawSync(service ? service.photo : NO_PHOTO);
  const folder = useFolderArtistPhoto(path);
  return online ?? folder;
}
