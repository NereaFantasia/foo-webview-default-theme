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
import { FormatBadge } from '../../../track/FormatBadge.tsx';
import { TrackByline } from '../../../track/TrackByline.tsx';
import { TruncatedText } from '../../../kit/TruncatedText.tsx';
import { useTextSwap } from '../../../playback/now-playing/useTextSwap.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { NowPlayingFavorite } from './NowPlayingFavorite.tsx';

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
 * 宽窗标题栏正中的正在播放条（540 × 52）：左端封面（按下进沉浸视图），第一行显示曲名与右上角格式标记，第二行显示艺人与专辑（`TrackByline`）与右端星级（在线曲目没有星级，换成收藏键）
 * 贴底提供可点击拖动的进度条，悬停时进入划动寻轨态（`ScrubSeek`）并将非封面区域模糊淡化，右端操作按钮打开当前曲目菜单
 * 在线曲目在格式标记位置展示音质标记（`QualityButton`），支持点击切换音质
 * 停止状态下封面显示占位图标，曲名显示「未在播放」且不绘制进度线；播放中曲名超出时截断右缘并定时滚动，悬停可查看完整文本；
 * 署名艺人与专辑超出时通过省略号截断且保持点击链接，星级与格式标记固定展示不让位
 * 切换曲目时文本执行退出与进入过渡（`useTextSwap`，寻轨态下直接替换），封面配合擦除动画（`NowPlayingCover`）
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
            track && <FormatBadge track={track} reading={format} size="small" />
          )}
        </div>
        <div ref={subRow} className={`${styles.subRow} ${styles.soft}`}>
          <TrackByline pointerOnly className={styles.byline} track={track} />
          <NowPlayingRating size="compact" track={track} />
          <NowPlayingFavorite path={track?.path} />
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
