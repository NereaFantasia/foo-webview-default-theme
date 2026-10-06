import { AlbumRegular, MicRegular } from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import styles from './TrackByline.module.css';
import { TruncatedText } from './TruncatedText.tsx';

export interface TrackBylineProps {
  readonly track: Track | null;
  /** 字号、颜色与在行里怎么伸缩，由各形态自己给。 */
  readonly className: string;
  readonly scroll?: boolean;
}

/**
 * 播放栏曲名下面那一行：艺人与专辑，各带侧边栏同款的图标（话筒、专辑），没写的那一项不出。两项作一行截断、
 * 滚动，悬停提示是「艺人 · 专辑」。读屏把图标念成字段名，免得两个名字连在一起分不清。
 */
export function TrackByline({ track, className, scroll }: TrackBylineProps) {
  const t = useAtomValueRawSync(translateAtom);
  const artist = track?.artist ?? '';
  const album = track?.album ?? '';
  return (
    <TruncatedText
      scroll={scroll}
      className={className}
      text={[artist, album].filter(Boolean).join(' · ')}
    >
      {artist && (
        <span className={styles.part}>
          <MicRegular className={styles.icon} aria-label={t('trackInfo.artist')} />
          {artist}
        </span>
      )}
      {album && (
        <span className={styles.part}>
          <AlbumRegular className={styles.icon} aria-label={t('trackInfo.album')} />
          {album}
        </span>
      )}
    </TruncatedText>
  );
}
