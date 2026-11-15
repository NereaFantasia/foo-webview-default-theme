import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect } from 'react';
import { currentTrackAtom } from '../playback/playback.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import { animatedCoverAtom, wantAnimatedCover } from './animatedCover.ts';
import styles from './AnimatedCoverImage.module.css';

/**
 * 正在播放的这一首封面是动图时，叠在静态封面上播放；不是动图、没读到或还在读时什么也不画，静态封面照旧
 * 挂上就登记要动图，服务才会去读原文件，卸载即撤销
 *
 * - `fill`：绝对定位铺满外框，外框要有定位
 * - `stack`：落在外框的网格第一格，与静态封面叠在一起，外框没有定位时用
 *
 * `track` 缺省取正在播放的；给了别的曲目就不画，动图只读正在播放的那一首
 */
export function AnimatedCoverImage({
  track,
  layout,
  fit,
}: {
  readonly track?: Pick<Track, 'path' | 'subsong'> | null;
  readonly layout: 'fill' | 'stack';
  readonly fit: 'cover' | 'contain';
}) {
  const store = useStore();
  useEffect(() => wantAnimatedCover(store), [store]);
  const playing = useAtomValueRawSync(currentTrackAtom);
  const cover = useAtomValueRawSync(animatedCoverAtom);
  if (!cover || cover.key !== trackKeyOf(track === undefined ? playing : track)) return null;
  return (
    <img
      className={styles.image}
      data-layout={layout}
      data-fit={fit}
      src={cover.url}
      alt=""
      draggable={false}
      data-animated-cover
    />
  );
}
