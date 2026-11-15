import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { CoverTheme } from '../../../covers/CoverTheme.tsx';
import type { Album } from '../../../host/libraryContract.ts';
import { useService } from '../../../kit/useService.ts';
import { albumCoversVersionAtom } from '../../albumCovers.ts';
import { albumsKey } from '../../albumServices.ts';
import { useArtistPortrait } from './useArtistPortrait.ts';

/** 头部整幅铺满的那一层：静帧（加载中时为空）、静帧载入前的底色及动态艺术照的 mp4 */
export interface HeroLayer {
  readonly url?: string;
  readonly color?: string;
  readonly video?: string;
}

/**
 * 艺人页取色与背景光晕：优先取头像或横幅照片，照片就绪前或无照片时回退至最新专辑封面
 *
 * 传入 `children` 的参数包含是否有可用图像（决定是否渲染光晕）及头部铺满层配置；
 * 存在宽幅图时，光晕层置于图像下方，在图像底部渐隐及滚出视口后持续承接页面基底色调
 */
export function ArtistColorTheme({
  album,
  live,
  children,
}: {
  readonly album: Album | null;
  /** 头部动态艺术照：光晕取其画面并在播放时同步采样 */
  readonly live?: HTMLVideoElement | null;
  readonly children: (glow: boolean, hero: HeroLayer | undefined) => ReactNode;
}) {
  const albums = useService(albumsKey);
  const { shown, hero, wide, heroColor, video } = useArtistPortrait();
  useAtomValueRawSync(albumCoversVersionAtom);
  const cover = album ? albums.covers.coverOf(album, 256) : undefined;
  // 头像就绪前暂用封面取色，待尺寸测量完成与头部同步切换至照片
  const url = hero || shown?.photo.url || (cover?.status === 'ready' ? cover.url : '');
  return (
    <CoverTheme url={url} reuse video={live ?? null}>
      {children(
        url !== '',
        wide
          ? {
              ...(hero ? { url: hero } : {}),
              ...(heroColor ? { color: heroColor } : {}),
              ...(video ? { video } : {}),
            }
          : undefined,
      )}
    </CoverTheme>
  );
}
