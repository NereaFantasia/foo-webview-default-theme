import { RecordRegular, MicRegular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';

interface TrackMetadataProps {
  readonly artist: string;
  readonly album: string;
  readonly className?: string;
  /** 换掉艺人、专辑的纯文字，如可点的名字；焦点规则由所在页面定 */
  readonly artistContent?: ReactNode;
  readonly albumContent?: ReactNode;
}

export function TrackMetadata({
  artist,
  album,
  artistContent,
  albumContent,
  className,
}: TrackMetadataProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <Metadata className={className}>
      {artist && (
        <MetadataItem icon={<MicRegular />} label={t('trackInfo.artist')} title={artist}>
          {artistContent ?? artist}
        </MetadataItem>
      )}
      {album && (
        <MetadataItem icon={<RecordRegular />} label={t('trackInfo.album')} title={album}>
          {albumContent ?? album}
        </MetadataItem>
      )}
    </Metadata>
  );
}
