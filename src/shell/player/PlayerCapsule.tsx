import { Button, Tooltip, makeStyles } from '@fluentui/react-components';
import { MoreHorizontal16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useRef, useState } from 'react';
import { VideoEntryContext } from '../../nav/videoEntry.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { sidebarViewAtom } from '../../nav/sidebar/sidebarView.ts';
import { roleVar } from '../../theme/roles.ts';
import { CapsuleVolume } from './volume/CapsuleVolume.tsx';
import { NowPlayingMenu } from './context-menu/NowPlayingMenu.tsx';
import { useNowPlayingMenu } from './context-menu/useNowPlayingMenu.ts';
import { displayTitle } from './now-playing/nowPlaying.ts';
import { NowPlayingEntry } from './now-playing/NowPlayingEntry.tsx';
import { NowPlayingRating } from './now-playing/NowPlayingRating.tsx';
import { currentTrackAtom } from '../../playback/playback.ts';
import { PlaybackControls } from './PlaybackControls.tsx';
import styles from './PlayerCapsule.module.css';
import { handOffPlayerFocus, PLAYER_KEY_ATTR } from './playerFocus.ts';
import { ScrubSeek, type ScrubState } from './ScrubSeek.tsx';
import { TrackByline } from './TrackByline.tsx';
import { TruncatedText } from './TruncatedText.tsx';
import { useTextSwap } from './now-playing/useTextSwap.ts';

const useStyles = makeStyles({
  more: {
    minWidth: '28px',
    width: '28px',
    height: '36px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
});

/** 圆形封面的边长，CSS 像素。 */
const COVER = 48;

/**
 * 浮在内容卡底部正中的胶囊：播放栏是胶囊形态时各档宽度都用它，放在标题栏时窄窗（< 1008）换成它；没有
 * 当前曲目时不出，卸下时焦点在里面就交给标题栏的 ⋯。盖住的那一截内容由页面按 `--player-inset` 让出来。
 * 宽窗 680、641–1007 宽 600，卡片窄到放不下时撑满卡宽。
 * 左端圆形封面（按下进沉浸视图），曲名（后面跟着星级）与艺人、专辑（`TrackByline`）两行，右边是播放控制组与「音量、⋯」两组；贴底一条细的进度线，能点
 * 能拖，悬停它进悬停态（`ScrubSeek`），封面以外的东西模糊变淡。窗口 ≤ 640 时胶囊撑满卡宽、左右各留 16，
 * 去掉播放顺序键、音量键与星级。过长的文字截断、右缘渐隐、定时滚动一遍，悬停出全文；星不让位。换曲时两行字
 * 先退后进（`useTextSwap`，悬停态里直接换），圆形封面转入（`NowPlayingCover`）。
 */
export function PlayerCapsule() {
  const videoEntry = useContext(VideoEntryContext);
  const t = useAtomValueRawSync(translateAtom);
  const live = useAtomValueRawSync(currentTrackAtom);
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const compact = tier === 'hidden';
  const classes = useStyles();
  const [scrub, setScrub] = useState<ScrubState | undefined>(undefined);
  const text = useRef<HTMLDivElement>(null);
  const track = useTextSwap(live, [text], scrub !== 'on');
  const menu = useNowPlayingMenu(track);
  return (
    <div
      ref={handOffPlayerFocus}
      className={styles.root}
      role="group"
      aria-label={t('player.nowPlaying')}
      data-player-capsule
      data-tier={tier}
      data-rating-host
      data-scrub={scrub}
      {...menu.trigger}
    >
      <NowPlayingEntry size={COVER} shape="round" />
      <div ref={text} className={`${styles.text} ${styles.soft}`}>
        <div className={styles.titleRow}>
          <TruncatedText
            scroll
            className={styles.title}
            data-idle={!track || undefined}
            text={track ? displayTitle(track) : t('player.idle')}
          />
          {!compact && <NowPlayingRating size="compact" track={track} />}
        </div>
        <TrackByline scroll className={styles.byline} track={track} />
      </div>
      <div className={`${styles.controls} ${styles.soft}`}>
        <PlaybackControls compact={compact} />
      </div>
      <div ref={handOffPlayerFocus} className={`${styles.tail} ${styles.soft}`}>
        {videoEntry}
        {/* 窗口缩到 640 以下时音量键单独卸下，焦点也要跟走。 */}
        {!compact && (
          <span ref={handOffPlayerFocus} className={styles.slot}>
            <CapsuleVolume />
          </span>
        )}
        <Tooltip content={t('player.more')} relationship="label">
          <Button
            appearance="subtle"
            className={classes.more}
            icon={<MoreHorizontal16Regular />}
            {...menu.more}
            {...{ [PLAYER_KEY_ATTR]: 'more' }}
          />
        </Tooltip>
      </div>
      <ScrubSeek form="capsule" onScrubChange={setScrub} />
      <NowPlayingMenu at={menu.at} onClose={menu.close} />
    </div>
  );
}
