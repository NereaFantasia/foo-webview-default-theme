import { MusicNote220Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import styles from './NowPlayingCover.module.css';
import { CoverLayers } from '../../../playback/now-playing/CoverLayers.tsx';
import { nowPlayingAtom } from '../../../playback/now-playing/nowPlaying.ts';

export interface NowPlayingCoverProps {
  /** 边长，CSS 像素 */
  readonly size: number;
  /**
   * 圆角：`lcd` 只圆左边两角，与正在播放条的外框同一条弧，右边贴着文字是直的；`bar` 四角 4；`round` 是圆
   * 换曲的过渡也按它分：`bar` 推入，`lcd` 擦除，`round` 转入（`swapMotion.ts`）
   */
  readonly shape: 'lcd' | 'bar' | 'round';
}

/**
 * 正在播放那一首的封面。没有曲目、问不到地址、图解不出（这一首没有封面）时画占位图标；解不出只认那个地址，
 * 换曲换了地址就再试。纯装饰，名字由旁边的曲名给。换图的叠层与过渡在 `CoverLayers`
 */
export function NowPlayingCover({ size, shape }: NowPlayingCoverProps) {
  const { key, cover } = useAtomValueRawSync(nowPlayingAtom);
  const [broken, setBroken] = useState<string | null>(null);
  const target = key && cover && cover !== broken ? cover : null;
  return (
    <CoverLayers
      className={styles.root}
      style={{ width: size, height: size }}
      data-shape={shape}
      aria-hidden
      url={target}
      shape={shape}
      placeholder={<MusicNote220Regular className={styles.placeholder} />}
      onBroken={setBroken}
    />
  );
}
