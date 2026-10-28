import { TrackAlbum, TrackArtists } from './TrackCredits.tsx';
import { TrackMetadata } from './TrackMetadata.tsx';
import type { LinkableTrack } from './trackLinks.ts';
import styles from './TrackByline.module.css';
import { TruncatedText } from '../kit/TruncatedText.tsx';

export interface TrackBylineProps {
  /** 只用艺人、专辑与跳转要的字段，所以回看、接下来的行也能写 */
  readonly track: LinkableTrack | null;
  /** 字号、颜色与在行里怎么伸缩，由各形态自己给 */
  readonly className: string;
  /**
   * 放不下时艺人、专辑各自用省略号截断，名字始终可点，不滚动；缺省交给 `TruncatedText` 截断加右缘渐隐。
   * 要用省略号的形态有定好的 Tab 顺序，署名只给指针，键盘走菜单
   */
  readonly ellipsis?: boolean;
  /** 放不下时怎么给全文，见 `TruncatedText`；用省略号时每个名字自带浏览器的 `title` 提示 */
  readonly hint?: 'tooltip' | 'title';
}

/**
 * 播放栏曲名下面那一行：艺人与专辑，各带侧边栏同款的图标（话筒、专辑），没写的那一项不出。读屏把图标念成字段名，
 * 免得两个名字连在一起分不清；名字可点，转到艺人、专辑也可以走菜单
 */
export function TrackByline({ track, className, ellipsis = false, hint }: TrackBylineProps) {
  const artist = track?.artist ?? '';
  const album = track?.album ?? '';
  const tabIndex = ellipsis ? -1 : undefined;
  const metadata = (
    <TrackMetadata
      className={ellipsis ? `${styles.root} ${className}` : styles.root}
      artist={artist}
      album={album}
      artistContent={track ? <TrackArtists track={track} tabIndex={tabIndex} /> : undefined}
      albumContent={track ? <TrackAlbum track={track} tabIndex={tabIndex} /> : undefined}
    />
  );
  if (ellipsis) return metadata;
  return (
    <TruncatedText
      hint={hint}
      className={className}
      text={[artist, album].filter(Boolean).join(' · ')}
    >
      {metadata}
    </TruncatedText>
  );
}
