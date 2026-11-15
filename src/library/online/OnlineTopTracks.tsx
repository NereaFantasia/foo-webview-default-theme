import { Button } from '@fluentui/react-components';
import { MoreHorizontal16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { onlineKey } from '../../playback/onlineTracks.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import { durationText } from '../../table/cellText.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { PlayingMark } from '../../track/PlayingMark.tsx';
import { LinkedAlbum } from '../../track/TrackCredits.tsx';
import { musicTrackLinks } from '../../track/trackLinks.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import {
  TopTrackButton,
  TopTrackEnd,
  TopTrackItem,
  TopTrackList,
  TopTrackText,
} from '../detail/TopTrackList.tsx';
import { blockedTrack, bestQuality, Cover, QUALITY_LABELS } from '../search/online/OnlineItems.tsx';
import styles from './OnlineArtistPage.module.css';

/** 默认露出的行数上限：三栏时 12 首，超出时标题行右侧出「显示全部」 */
const PREVIEW_COUNT = 12;

/**
 * 艺人的热门歌曲：平台给的前 50 首，栏数与行样式同本地艺人页。双击或回车从这一行起播，队列是已取到的全部热门歌曲；
 * 右键或 ⋯ 出单曲的菜单。没有选中、多选与排序；放不了的曲目（无版权又没开补全）变灰、不起播
 */
export function OnlineTopTracks({
  tracks,
  playing,
  paused,
  unblock,
  onPlay,
  onMenu,
}: {
  readonly tracks: readonly MusicTrack[];
  /** 正在播的在线曲目的键 */
  readonly playing: string | null;
  readonly paused: boolean;
  readonly unblock: boolean | null;
  onPlay(index: number): void;
  onMenu(track: MusicTrack, at: TablePoint): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const [expanded, setExpanded] = useState(false);
  if (tracks.length === 0) return null;
  const title = t('artistAlbums.tab.songs');
  const overflow = tracks.length > PREVIEW_COUNT;
  return (
    <section aria-label={title} data-online-artist-songs>
      <div className={styles.head}>
        <h2 className={styles.heading}>{title}</h2>
        {overflow && (
          <Button
            appearance="transparent"
            size="small"
            className={controls.plain}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t('artists.showLess') : t('artists.showAll', { count: tracks.length })}
          </Button>
        )}
      </div>
      <TopTrackList count={tracks.length} label={title} expanded={expanded}>
        {tracks.map((track, index) => {
          const dimmed = blockedTrack(track, unblock);
          const quality = bestQuality(track);
          const isPlaying = onlineKey(track.ref) === playing;
          // 专辑名能跳的可点，行里的单击、双击与按下都由链接自己接住，不触发起播
          const { album } = musicTrackLinks(track);
          const play = () => {
            if (!dimmed) onPlay(index);
          };
          return (
            <TopTrackItem
              key={track.ref.id}
              row={
                <TopTrackButton
                  dimmed={dimmed}
                  playing={isPlaying}
                  data-online-top-track={track.ref.id}
                  title={dimmed ? t('online.blockedHint') : undefined}
                  onDoubleClick={play}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    play();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onMenu(track, { x: event.clientX, y: event.clientY });
                  }}
                >
                  <Cover src={track.artwork} size={40} />
                  <TopTrackText
                    title={track.title}
                    sub={album && <LinkedAlbum album={album} tabIndex={-1} />}
                  />
                  <TopTrackEnd>
                    {isPlaying && <PlayingMark active={!paused} label={t('table.nowPlaying')} />}
                    {quality && <span>{t(QUALITY_LABELS[quality])}</span>}
                    {track.durationMs !== null && (
                      <span>{durationText(track.durationMs / 1000)}</span>
                    )}
                  </TopTrackEnd>
                </TopTrackButton>
              }
              more={
                <Button
                  appearance="subtle"
                  shape="circular"
                  size="small"
                  className={controls.icon}
                  icon={<MoreHorizontal16Regular />}
                  aria-label={t('album.tileMore')}
                  tabIndex={-1}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    onMenu(track, { x: box.left, y: box.bottom });
                  }}
                />
              }
            />
          );
        })}
      </TopTrackList>
    </section>
  );
}
