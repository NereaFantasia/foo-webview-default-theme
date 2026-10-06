import { Button, Tooltip, createPresenceComponent } from '@fluentui/react-components';
import {
  ChevronDown16Regular,
  MoreHorizontal16Regular,
  MusicNote2Regular,
} from '@fluentui/react-icons';
import type { Track } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { FOLD_CLOSE, FOLD_OPEN } from '../../motion/foldMotion.ts';
import { useRightCard } from './rightCardContext.ts';
import styles from './RightCardHead.module.css';
import { useCurrentTrackMotion } from './useCurrentTrackMotion.ts';
import { useQueueCover } from './queue/useQueueCover.ts';
import { QueueRating } from './queue/QueueRating.tsx';
import type { RowPoint } from './queue/QueueRow.tsx';

/** 没有标题标签时写文件名（去掉扩展名），与 fb2k 的缺省显示一致。 */
export function titleOf(track: Pick<Track, 'title' | 'path'>): string {
  if (track.title) return track.title;
  const name = track.path.split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[^.]+$/, '') || track.path;
}

/**
 * 封面展开、收起照 WinUI Expander：版式当场到终值，展开时这一块从上面滑下来（333 ms），收起时滑上去
 * （167 ms），播完才换回收起的那一行。滑动被外面那一层裁掉。
 */
export const CoverFold = createPresenceComponent(() => {
  const keyframes = [{ translate: '0 -100%' }, { translate: '0 0' }];
  return {
    enter: { keyframes, duration: FOLD_OPEN.duration, easing: FOLD_OPEN.curve.timing },
    exit: {
      keyframes: [...keyframes].reverse(),
      duration: FOLD_CLOSE.duration,
      easing: FOLD_CLOSE.curve.timing,
    },
  };
});

interface CoverProps {
  readonly url: string | null;
  readonly className: string;
}

/** 封面；没有地址或图片加载出错时画占位图标。换了地址重新试。 */
function Cover({ url, className }: CoverProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = url && failed !== url ? url : null;
  return (
    <span
      className={className}
      data-current-part="cover"
      data-motion-identity={shown ?? ''}
      data-placeholder={!shown || undefined}
    >
      {shown ? (
        <img src={shown} alt="" draggable={false} onError={() => setFailed(shown)} />
      ) : (
        <MusicNote2Regular />
      )}
    </span>
  );
}

/**
 * 右侧卡的头，写正在播放的这一首。封面收起时是 44 的缩略图、标题、艺术家与专辑、评分，右侧提供操作与展开键；
 * 展开时封面为 1:1、最大 288，点封面收起。专辑名是去专辑详情页的链接，媒体库里找不到时不是链接。
 * 未在播放时画占位封面，标题写「未在播放」。换态时焦点在头里的，跟到另一态开合的那个键上。
 */
export function RightCardHead({ onMenu }: { onMenu(track: Track, at: RowPoint): void }) {
  const t = useAtomValueRawSync(translateAtom);
  const { card, deps } = useRightCard();
  const { coverCollapsed } = useAtomValueRawSync(card.view).prefs;
  const track = useAtomValueRawSync(deps.current);
  const title = track ? titleOf(track) : t('rightCard.idle');
  const toggleLabel = coverCollapsed ? t('rightCard.showCover') : t('rightCard.hideCover');
  const openAlbum = track ? deps.albumOpener(track) : null;
  const openArtist = track ? deps.artistOpener(track) : null;
  const openMenu = (at: RowPoint) => {
    if (track) onMenu(track, at);
  };
  const more = track && (
    <Tooltip content={t('queue.more')} relationship="label">
      <Button
        appearance="subtle"
        size="small"
        icon={<MoreHorizontal16Regular />}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          openMenu({ x: box.left, y: box.bottom });
        }}
      />
    </Tooltip>
  );
  // 收起那一行要等展开的那一块滑走才出；展开时当场收掉。
  const [folded, setFolded] = useState(coverCollapsed);
  if (!coverCollapsed && folded) setFolded(false);
  const head = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const toggle = () => {
    refocus.current = head.current?.contains(document.activeElement) ?? false;
    card.toggleCover();
  };
  const showRow = coverCollapsed && folded;
  const cover = useQueueCover(track?.handle || track?.path || '', !showRow);
  useCurrentTrackMotion(head, track?.handle ?? null, cover, coverCollapsed);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    const target = head.current?.querySelector<HTMLElement>('[data-cover-toggle]');
    if (target) {
      refocus.current = false;
      // 开合的位移还没播完，新键此刻可能看着在视口外；不让浏览器为它滚动队列，前面那几首会被滚出来。
      target.focus({ preventScroll: true });
    }
  }, [showRow, coverCollapsed]);
  const settle = (_: null, data: { direction: 'enter' | 'exit' }) => {
    if (data.direction === 'exit') setFolded(true);
  };
  const subtitle = track && (
    <span className={styles.subtitle}>
      {track.artist}
      {track.artist && track.album && ' · '}
      {track.album &&
        (openAlbum ? (
          <button type="button" className={styles.link} onClick={openAlbum}>
            {track.album}
          </button>
        ) : (
          track.album
        ))}
    </span>
  );

  return (
    <div
      ref={head}
      className={styles.current}
      data-queue-current
      data-playing={!!track || undefined}
      onContextMenu={(event) => {
        if (!track) return;
        event.preventDefault();
        event.stopPropagation();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className={styles.fold}>
        <CoverFold
          visible={!coverCollapsed}
          unmountOnExit
          onMotionFinish={settle}
          onMotionCancel={settle}
        >
          <div className={styles.expanded}>
            <button
              type="button"
              className={styles.bigCoverButton}
              aria-label={t('rightCard.hideCover')}
              data-cover-toggle={coverCollapsed ? undefined : ''}
              onClick={toggle}
            >
              <Cover url={cover} className={styles.bigCover} />
            </button>
            <div className={styles.details}>
              <span
                className={styles.title}
                data-current-part="title"
                data-motion-identity={track?.handle ?? ''}
              >
                {title}
              </span>
              {track && (
                <>
                  <span
                    className={styles.artist}
                    data-current-part="artist"
                    data-motion-identity={track?.handle ?? ''}
                  >
                    {openArtist ? (
                      <button type="button" className={styles.link} onClick={openArtist}>
                        {track.artist}
                      </button>
                    ) : (
                      track.artist
                    )}
                  </span>
                  <span
                    className={styles.album}
                    data-current-part="album"
                    data-motion-identity={track?.handle ?? ''}
                  >
                    {openAlbum ? (
                      <button type="button" className={styles.link} onClick={openAlbum}>
                        {track.album}
                      </button>
                    ) : (
                      track.album
                    )}
                  </span>
                  <div
                    className={styles.actions}
                    data-current-part="actions"
                    data-motion-identity={track?.handle ?? ''}
                  >
                    <QueueRating track={track} size="medium" />
                    {more}
                  </div>
                  <span
                    className={styles.technical}
                    data-current-part="technical"
                    data-motion-identity={track?.handle ?? ''}
                  >
                    {[
                      track.codec,
                      track.sampleRate > 0 ? `${track.sampleRate / 1000} kHz` : '',
                      track.bitrate > 0 ? `${track.bitrate} kbps` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </CoverFold>
      </div>
      {showRow && (
        <div className={styles.collapsed}>
          <button
            type="button"
            className={styles.thumbButton}
            aria-label={toggleLabel}
            onClick={toggle}
          >
            <Cover url={cover} className={styles.thumb} />
          </button>
          <div
            className={styles.text}
            data-current-part="text"
            data-motion-identity={track?.handle ?? ''}
          >
            <span className={styles.title}>{title}</span>
            {subtitle}
            {track && <QueueRating track={track} />}
          </div>
          <div className={styles.rowActions}>
            {more}
            <Tooltip content={toggleLabel} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<ChevronDown16Regular />}
                data-cover-toggle=""
                onClick={toggle}
              />
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
