import { MusicNote224Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { CSSProperties } from 'react';
import { immersiveCoverAtom, immersiveCoverKey } from '../../covers/immersiveCover.ts';
import type { ImmersiveCoverState } from '../../covers/immersiveCover.ts';
import { CoverLayers } from '../../playback/now-playing/CoverLayers.tsx';
import { useLease } from '../lease/useLease.ts';
import { SCENE_COVER_LAYER } from '../scene/coverHolders.ts';
import { useCoverHolder } from '../scene/useCoverHolder.ts';
import styles from './CoverArt.module.css';

export interface CoverArtProps {
  /** 圆角，CSS 像素；缺省 12 */
  readonly radius?: number;
  /** 外部投影效果开关（默认开启） */
  readonly shadow?: boolean;
}

/** 计算当前目标封面资源地址（缺图或加载失败时返回 null 呈现占位） */
export function coverTarget(cover: Pick<ImmersiveCoverState, 'url' | 'status'>): string | null {
  return cover.status === 'loading' || cover.status === 'shown' ? cover.url : null;
}

/**
 * 沉浸视图当前曲目大封面组件
 *
 * 填充容器指定的正方形区域；封面资源由 immersiveCoverKey 托管（512px 规格，与背景共享缓存）；
 * 切歌时保留旧图直至新图解码完成，按切曲方向滑块擦除转场（同专辑或延迟过长回退渐变过渡）；
 * 明确无图时呈现占位图标，加载中仅展示中性底色以避免闪烁；通过 useCoverHolder 持有共享过渡命名，纯装饰呈现
 */
export function CoverArt({ radius = 12, shadow = true }: CoverArtProps) {
  const cover = useAtomValueRawSync(immersiveCoverAtom);
  const service = useLease(immersiveCoverKey);
  const holder = useCoverHolder(SCENE_COVER_LAYER);
  // 封面未就绪时保持中性底色以防闪烁
  const waiting = cover.status === 'loading' && cover.url === null;
  // 基于图片令牌回报解码完成状态，丢弃过期回调
  const report = (url: string, done: (token: number) => void) => {
    if (url === cover.url) done(cover.token);
  };
  return (
    <div
      ref={holder}
      className={styles.cover}
      data-scene-element="cover"
      data-shadow={shadow || undefined}
      style={{ '--cover-radius': `${radius}px` } as CSSProperties}
      aria-hidden
    >
      <CoverLayers
        className={styles.layers}
        url={coverTarget(cover)}
        // 擦除：换曲的方向感最强，小封面的推入与转入在大封面上会冲出外框
        shape="lcd"
        placeholder={waiting ? null : <MusicNote224Regular className={styles.placeholder} />}
        onLoaded={(url) => report(url, (token) => service?.markLoaded(token))}
        onBroken={(url) => report(url, (token) => service?.markFailed(token))}
      />
    </div>
  );
}
