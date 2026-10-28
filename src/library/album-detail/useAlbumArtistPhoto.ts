import { fb } from 'foo-webview-sdk/bridge';
import { useEffect, useState } from 'react';
import { settle } from '../../host/hostCall.ts';

/** 内存 LRU 缓存：曲目路径映射至艺人照片地址，未解析或无图记录为 null，避免页面进出重复查询 */
const PHOTOS = new Map<string, string | null>();
const LIMIT = 64;

/**
 * 获取专辑详情页头的艺人插图地址
 * 以专辑首轨路径请求宿主解析 artist 类型插图；宿主仅拼接地址而不预检物理存在，加载失败由头像组件展示占位，不回退专辑封面
 */
export function useAlbumArtistPhoto(path: string | undefined): string | null {
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
