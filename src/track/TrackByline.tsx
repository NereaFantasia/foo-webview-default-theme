import { TrackAlbum, TrackArtists } from './TrackCredits.tsx';
import { TrackMetadata } from './TrackMetadata.tsx';
import type { LinkableTrack } from './trackLinks.ts';

export interface TrackBylineProps {
  /** 只用艺人、专辑与跳转要的字段，所以回看、接下来的行也能写 */
  readonly track: LinkableTrack | null;
  /** 字号、颜色与在行里怎么伸缩，由各形态自己给 */
  readonly className: string;
  /** 署名只给指针：名字不进 Tab 顺序，键盘走菜单。有定好 Tab 顺序的形态用它 */
  readonly pointerOnly?: boolean;
}

/**
 * 播放栏曲名下面那一行：艺人与专辑，中间隔一个「-」，没写的那一项不出。读屏按字段名分成两组，
 * 免得两个名字连在一起分不清；名字可点，转到艺人、专辑也可以走菜单
 *
 * 放不下时艺人与专辑均分宽度，各自用省略号截断，不滚动，每个名字自带浏览器的 `title` 提示；艺人几位铺不开时
 * 收成整串一个点击目标，点了弹菜单选人
 */
export function TrackByline({ track, className, pointerOnly = false }: TrackBylineProps) {
  const tabIndex = pointerOnly ? -1 : undefined;
  return (
    <TrackMetadata
      share
      className={className}
      artist={track?.artist ?? ''}
      album={track?.album ?? ''}
      artistContent={track ? <TrackArtists track={track} tabIndex={tabIndex} /> : undefined}
      albumContent={track ? <TrackAlbum track={track} tabIndex={tabIndex} /> : undefined}
    />
  );
}
