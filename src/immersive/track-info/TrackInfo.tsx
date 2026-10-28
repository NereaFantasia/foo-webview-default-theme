import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef } from 'react';
import { trackOrigin } from '../../host/trackOrigin.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { TruncatedText } from '../../kit/TruncatedText.tsx';
import { marqueeSpeedFor } from '../../kit/marquee.ts';
import { useWidthTier } from '../../kit/useWidthTier.ts';
import { NowPlayingMenu } from '../../playback/now-playing/NowPlayingMenu.tsx';
import { QualityButton } from '../../playback/now-playing/QualityButton.tsx';
import { displayTitle, nowPlayingAtom } from '../../playback/now-playing/nowPlaying.ts';
import { useNowPlayingMenu } from '../../playback/now-playing/useNowPlayingMenu.ts';
import { useTextSwap } from '../../playback/now-playing/useTextSwap.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import type { UpNextTrack } from '../../playback/queue/upNextModel.ts';
import { useDisplayTrack } from '../../track/displayTrack.ts';
import { NowPlayingRating } from '../../track/NowPlayingRating.tsx';
import { TrackByline } from '../../track/TrackByline.tsx';
import { formatBadge, type FormatReading } from '../../track/trackFormat.ts';
import { coverflowSelectionAtom } from '../scene/coverflowAtoms.ts';
import styles from './TrackInfo.module.css';
import {
  COLLAPSE_TIERS,
  INFO_SIZES,
  partsOf,
  type CollapseTier,
  type InfoSize,
} from './trackInfoLayout.ts';
import { useSelectionSwap } from './useSelectionSwap.ts';

/**
 * 当前曲目信息展示数据源
 *
 * 区分实时播放曲目（展示完整音频规格徽标、音质选择与上下文菜单）与封面流浏览曲目（精简展示曲名与艺人信息）
 */
type Shown =
  | { readonly kind: 'live'; readonly track: Track | null; readonly format: FormatReading }
  | { readonly kind: 'browsed'; readonly track: UpNextTrack; readonly title: string };

export interface TrackInfoProps {
  /** 尺寸档位，由预设模板按窗口高度映射分配 */
  readonly size: InfoSize;
  /** 水平对齐方式；分栏视图默认靠左，居中视图与封面流居中对齐 */
  readonly align?: 'start' | 'center';
  /** 标题溢出策略；scroll 为跑马灯滚动，clip 为省略截断；减弱动效时统一截断 */
  readonly overflow?: 'scroll' | 'clip';
}

/** 上下文菜单触发范围；排除评级与音质按键等内嵌交互元素 */
const MENU_SCOPE = {
  anchor: () => null,
  accepts: (target: Element) => !target.closest('button, [role="radiogroup"]'),
};

/**
 * 沉浸模式曲目元信息主副标题组件
 *
 * 首行渲染曲名与音质/音频规格徽标，次行呈现艺人、专辑链接与实时评级，宽度受限时按预设优先级阶梯折叠次要信息；
 * 支持当前播放与封面流浏览曲目无缝切换，伴随平滑文字翻页退换动效，容器尺寸变更时动态更新档位而不重挂组件
 */
export function TrackInfo({ size, align = 'start', overflow = 'scroll' }: TrackInfoProps) {
  const t = useAtomValueRawSync(translateAtom);
  const liveTrack = useAtomValueRawSync(currentTrackAtom);
  const { format: liveFormat } = useAtomValueRawSync(nowPlayingAtom);
  const selection = useAtomValueRawSync(coverflowSelectionAtom);
  const swap = useSelectionSwap(selection);
  const titleRow = useRef<HTMLDivElement>(null);
  const subRow = useRef<HTMLDivElement>(null);
  const [measure, tier] = useWidthTier<CollapseTier, HTMLDivElement>(COLLAPSE_TIERS[size]);
  const browsed = useDisplayTrack(
    selection && selection.item.kind !== 'current' ? selection.item.track : null,
  );
  const wanted: Shown = browsed.track
    ? { kind: 'browsed', track: browsed.track, title: browsed.title }
    : { kind: 'live', track: liveTrack, format: liveFormat };
  // 徽标与曲名同处于标题行，退场动画期间保持上一首规格展示
  const shown = useTextSwap(wanted, [titleRow, subRow], true, swap);
  const { track } = shown;
  const full = shown.kind === 'live' ? shown : null;
  const parts = partsOf(tier);
  const badge = full?.track ? formatBadge(full.track, full.format) : null;
  const menu = useNowPlayingMenu(full?.track ?? null, MENU_SCOPE);
  const online = full?.track ? trackOrigin(full.track.path) === 'online' : false;
  const scroll = overflow === 'scroll';
  const speed = marqueeSpeedFor(INFO_SIZES[size].title);
  return (
    <div
      ref={measure}
      className={styles.root}
      role="group"
      aria-label={t('player.nowPlaying')}
      data-scene-element="info"
      data-size={size}
      data-align={align}
      data-rating-host
      {...menu.trigger}
    >
      <div ref={titleRow} className={styles.titleRow}>
        <TruncatedText
          hint="title"
          scroll={scroll}
          loop="conveyor"
          speed={speed}
          className={styles.title}
          data-idle={!track || undefined}
          text={
            shown.kind === 'browsed' ? shown.title : track ? displayTitle(track) : t('player.idle')
          }
        />
        {parts.badge &&
          (full?.track && online ? (
            <span className={styles.badge}>
              <QualityButton track={full.track} size="large" />
            </span>
          ) : (
            badge && (
              <span className={styles.badge} data-format-badge>
                <span className={styles.codec}>{badge.codec}</span>
                {parts.detail && badge.detail && (
                  <span className={styles.detail}>{badge.detail}</span>
                )}
              </span>
            )
          ))}
      </div>
      <div ref={subRow} className={styles.subRow}>
        <TrackByline hint="title" className={styles.sub} track={track} />
        {parts.rating && (
          <span className={styles.rating}>
            <NowPlayingRating size="large" track={track} />
          </span>
        )}
      </div>
      <NowPlayingMenu at={menu.at} onClose={menu.close} />
    </div>
  );
}
