import { Button, Tooltip, makeStyles, mergeClasses } from '@fluentui/react-components';
import { MoreHorizontal20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { roleVar } from '../../../theme/roles.ts';
import { NowPlayingMenu } from '../../../playback/now-playing/NowPlayingMenu.tsx';
import { useNowPlayingMenu } from '../../../playback/now-playing/useNowPlayingMenu.ts';
import { NowPlayingEntry } from './NowPlayingEntry.tsx';
import styles from './NowPlayingLcd.module.css';
import { NowPlayingRating } from '../../../track/NowPlayingRating.tsx';
import { QualityButton } from '../../../playback/now-playing/QualityButton.tsx';
import { displayTitle, nowPlayingAtom } from '../../../playback/now-playing/nowPlaying.ts';
import { trackOrigin } from '../../../host/trackOrigin.ts';
import { currentTrackAtom } from '../../../playback/playback.ts';
import {
  handOffPlayerFocus,
  MORE_SURFACE_ATTRIBUTES,
  PLAYER_KEY_ATTR,
  PLAYER_MENU_SCOPE,
  QUALITY_FOCUS,
} from '../playerFocus.ts';
import { ScrubSeek, type ScrubState } from '../ScrubSeek.tsx';
import { formatBadge } from '../../../track/trackFormat.ts';
import { TrackByline } from '../../../track/TrackByline.tsx';
import { TruncatedText } from '../../../kit/TruncatedText.tsx';
import { useTextSwap } from '../../../playback/now-playing/useTextSwap.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';

const useStyles = makeStyles({
  more: {
    minWidth: '28px',
    width: '28px',
    height: '36px',
    padding: '0',
    color: roleVar('text-secondary'),
  },
});

/** 封面边长，CSS 像素；与播放条齐高 */
const COVER = 52;

/**
 * 宽窗标题栏正中的正在播放条（540 × 52）：左端封面（按下进沉浸视图），曲名一行、右上是格式标记，第二行是艺人与专辑（`TrackByline`）、右端是星级，
 * 贴底一条能点能拖的进度线，悬停它进悬停态（`ScrubSeek`），封面以外的东西模糊变淡；右端 ⋯ 打开当前曲目菜单
 * 在线曲目在格式标记的位置放音质标记（`QualityButton`），点开换音质
 * 停止时封面换占位图标、曲名写「未在播放」、进度线不画。过长的曲名截断、右缘渐隐、定时滚动一遍，悬停出全文；
 * 过长的署名艺人与专辑各自用省略号截断，名字始终可点；星与格式标记不让位。
 * 换曲时两行字先退后进（`useTextSwap`，悬停态里直接换），封面擦除（`NowPlayingCover`）
 */
export function NowPlayingLcd() {
  const t = useAtomValueRawSync(translateAtom);
  const live = useAtomValueRawSync(currentTrackAtom);
  const { format: liveFormat } = useAtomValueRawSync(nowPlayingAtom);
  const classes = useStyles();
  const viewControls = useViewControlStyles();
  const [scrub, setScrub] = useState<ScrubState | undefined>(undefined);
  const titleRow = useRef<HTMLDivElement>(null);
  const subRow = useRef<HTMLDivElement>(null);
  // 格式标记与曲名同一行，退场期间也照上一首的写
  const { track, format } = useTextSwap(
    { track: live, format: liveFormat },
    [titleRow, subRow],
    scrub !== 'on',
  );
  const badge = track ? formatBadge(track, format) : null;
  const menu = useNowPlayingMenu(track, PLAYER_MENU_SCOPE);
  return (
    <div
      ref={handOffPlayerFocus}
      className={styles.root}
      role="group"
      aria-label={t('player.nowPlaying')}
      data-now-playing
      data-rating-host
      data-scrub={scrub}
      {...menu.trigger}
    >
      <NowPlayingEntry size={COVER} shape="lcd" />
      <div className={styles.main}>
        <div ref={titleRow} className={`${styles.titleRow} ${styles.soft}`}>
          <TruncatedText
            scroll
            className={styles.title}
            data-idle={!track || undefined}
            text={track ? displayTitle(track) : t('player.idle')}
          />
          {track && trackOrigin(track.path) === 'online' ? (
            <QualityButton track={track} {...QUALITY_FOCUS} />
          ) : (
            badge && (
              <span className={styles.badge} data-format-badge>
                <span className={styles.codec}>{badge.codec}</span>
                {badge.detail && <span className={styles.detail}>{badge.detail}</span>}
              </span>
            )
          )}
        </div>
        <div ref={subRow} className={`${styles.subRow} ${styles.soft}`}>
          <TrackByline ellipsis className={styles.byline} track={track} />
          <NowPlayingRating size="compact" track={track} />
        </div>
        <ScrubSeek form="lcd" onScrubChange={setScrub} />
      </div>
      <span className={`${styles.more} ${styles.soft}`}>
        <Tooltip content={t('player.more')} relationship="label">
          <Button
            appearance="subtle"
            className={mergeClasses(classes.more, viewControls.icon)}
            icon={<MoreHorizontal20Regular />}
            {...menu.more}
            {...{ [PLAYER_KEY_ATTR]: 'more' }}
          />
        </Tooltip>
      </span>
      <NowPlayingMenu
        at={menu.at}
        surfaceAttributes={MORE_SURFACE_ATTRIBUTES}
        onClose={menu.close}
      />
    </div>
  );
}
