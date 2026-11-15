import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';
import styles from './TrackMetadata.module.css';

interface TrackMetadataProps {
  readonly artist: string;
  readonly album: string;
  readonly className?: string;
  /** 换掉艺人、专辑的纯文字，如可点的名字；焦点规则由所在页面定 */
  readonly artistContent?: ReactNode;
  readonly albumContent?: ReactNode;
  /** 一行内不折行，放不下时艺人与专辑均分宽度、各自截断；缺省按外面给的版式，放不下就折行 */
  readonly share?: boolean;
}

export function TrackMetadata({
  artist,
  album,
  artistContent,
  albumContent,
  className,
  share = false,
}: TrackMetadataProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <Metadata className={`${styles.names} ${share ? styles.share : ''} ${className ?? ''}`}>
      {artist && (
        <MetadataItem label={t('trackInfo.artist')} title={artist}>
          {artistContent ?? artist}
        </MetadataItem>
      )}
      {album && (
        <MetadataItem label={t('trackInfo.album')} title={album}>
          {albumContent ?? album}
        </MetadataItem>
      )}
    </Metadata>
  );
}
