import { Menu } from '../../motion/Surfaces.tsx';
import { MenuSurface as MenuPopover } from '../../theme/MenuSurface.tsx';
import { createSnapshotSlot } from '../../nav/historyStack.ts';
import { mainHistoryAtom } from '../../nav/navHistory.ts';
import {
  Button,
  MenuItem,
  MenuList,
  MenuTrigger,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  MoreHorizontal16Regular,
  Pause12Regular,
  Play12Regular,
  Stop16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { CURVE, DURATION_MS, motionDuration } from '../../motion/timing.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { QueueList } from '../../playback/queue/QueueList.tsx';
import { RightCardHead } from './RightCardHead.tsx';
import styles from './RightCard.module.css';
import {
  RightCardBiographyContext,
  RightCardInformationContext,
  RightCardLyricsContext,
  useRightCard,
  useRightCardSnapshot,
} from './rightCardContext.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { LyricsPreviewContext, useLyricsPreview } from './lyrics/useLyricsPreview.ts';
import { RightCardNavigation } from './RightCardNavigation.tsx';

const SNAPSHOT = createSnapshotSlot<{
  scroll: number;
  infoScroll: number;
  focusedRow: string | null;
}>();

const useStyles = makeStyles({
  more: { minWidth: '28px', width: '28px', height: '28px', color: tokens.colorNeutralForeground3 },
});

/**
 * 工具条固定；信息页在内容区内单独管理固定身份与滚动分组。换页的入口是标题栏或导航行里的四个键，
 * 卡里不再有分页栏。队列页的播放历史挂在工具条与内容区之间的插槽里，不随内容区滚动
 */
export function RightCard() {
  const t = useAtomValueRawSync(translateAtom);
  const { card, deps } = useRightCard();
  const classes = useStyles();
  const controls = useViewControlStyles();
  const biography = useContext(RightCardBiographyContext);
  const information = useContext(RightCardInformationContext);
  const lyrics = useContext(RightCardLyricsContext);
  const { page, coverCollapsed } = useAtomValueRawSync(card.view).prefs;
  const preview = useLyricsPreview(page === 'lyrics');
  const source = useAtomValueRawSync(deps.source);
  const playbackState = useAtomValueRawSync(deps.playbackState);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  // 沉浸视图盖在主窗上时，它的队列页独占读取窗口，这里的队列不去抢
  const covered = useAtomValueRawSync(mainHistoryAtom).place.id === 'nowPlaying';
  const status = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const { entry, arrival } = useAtomValueRawSync(card.navigation);
  useRightCardSnapshot(
    SNAPSHOT,
    {
      capture: () => ({
        scroll: content.current?.scrollTop ?? 0,
        infoScroll:
          content.current?.querySelector('[data-track-info] > div:last-child')?.scrollTop ?? 0,
        focusedRow:
          document.activeElement instanceof HTMLElement
            ? (document.activeElement.closest<HTMLElement>('[data-queue-row]')?.dataset.queueRow ??
              null)
            : null,
      }),
      restore: (snapshot) => {
        if (!content.current) return;
        content.current.scrollTop = snapshot.scroll;
        const info = content.current.querySelector('[data-track-info] > div:last-child');
        if (info) info.scrollTop = snapshot.infoScroll;
        const row = [...content.current.querySelectorAll<HTMLElement>('[data-queue-row]')].find(
          (element) => element.dataset.queueRow === snapshot.focusedRow,
        );
        row?.focus({ preventScroll: true });
      },
    },
    page !== 'lyrics',
  );
  useLayoutEffect(() => {
    if (arrival && document.activeElement === document.body)
      preview.root.current?.focus({ preventScroll: true });
    if (!arrival || !content.current) return;
    const from = arrival.direction === 'back' ? -20 : 20;
    const animations = [
      content.current.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: motionDuration(DURATION_MS.faster, reduced),
        easing: CURVE.linear.timing,
      }),
      content.current.animate(
        [
          { transform: arrival.kind === 'step' ? `translateX(${from}px)` : 'translateY(20px)' },
          { transform: 'none' },
        ],
        {
          duration: motionDuration(DURATION_MS.normal, reduced),
          easing: CURVE.decelerateMid.timing,
        },
      ),
    ];
    return () => animations.forEach((animation) => animation.cancel());
  }, [entry, arrival, reduced, preview.root]);
  const StatusIcon =
    playbackState === 'paused'
      ? Pause12Regular
      : playbackState === 'stopped'
        ? Stop16Regular
        : Play12Regular;
  useLayoutEffect(() => {
    const animation = status.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration(DURATION_MS.faster, reduced),
      easing: CURVE.linear.timing,
    });
    return () => animation?.cancel();
  }, [playbackState, reduced]);
  const [reviewSlot, setReviewSlot] = useState<HTMLDivElement | null>(null);
  const [historySlot, setHistorySlot] = useState<HTMLDivElement | null>(null);
  return (
    <section
      ref={preview.root}
      className={styles.root}
      aria-label={t('rightCard.region')}
      data-right-card
      data-queue-bounds
      data-lyrics-preview={page === 'lyrics' || undefined}
      data-controls-visible={preview.visible || undefined}
      data-scrollbars-visible={preview.scrollbarsVisible || undefined}
      tabIndex={page === 'lyrics' ? 0 : -1}
      onScrollCapture={preview.scroll}
      onPointerMove={preview.pointer}
      onPointerEnter={preview.pointer}
      onPointerDown={preview.pointer}
      onPointerLeave={preview.pointerLeave}
      onFocusCapture={preview.focus}
      onBlurCapture={preview.blur}
    >
      <RightCardNavigation scope={preview.root} />
      {page === 'info' && information ? (
        information.toolbar
      ) : page === 'lyrics' ? null : (
        <div
          className={styles.toolbar}
          data-lyrics-preview-controls
          inert={!preview.visible}
          aria-hidden={!preview.visible || undefined}
        >
          <span
            ref={status}
            className={styles.following}
            data-right-card-playback-state={playbackState}
            aria-live="polite"
          >
            <StatusIcon className={styles.followingIcon} />
            {t(
              playbackState === 'paused'
                ? 'rightCard.paused'
                : playbackState === 'stopped'
                  ? 'rightCard.idle'
                  : 'rightCard.following',
            )}
          </span>
          <div className={styles.toolbarActions}>
            <div ref={setReviewSlot} />
            <Menu
              surfaceMotion={MENU_SURFACE_MOTION}
              onOpenChange={(_, data) => preview.setMenuOpen(data.open)}
            >
              <MenuTrigger disableButtonEnhancement>
                <Button
                  className={mergeClasses(classes.more, controls.icon)}
                  appearance="subtle"
                  size="small"
                  icon={<MoreHorizontal16Regular />}
                  aria-label={t('rightCard.more')}
                />
              </MenuTrigger>
              <MenuPopover data-right-card-surface>
                <MenuList>
                  {page === 'queue' && (
                    <MenuItem onClick={() => card.toggleCover()}>
                      {t(coverCollapsed ? 'rightCard.showCover' : 'rightCard.hideCover')}
                    </MenuItem>
                  )}
                  <MenuItem disabled={!source} onClick={() => deps.openSource()}>
                    {t('rightCard.openSource')}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        </div>
      )}
      <div ref={setHistorySlot} className={styles.history} />
      <div ref={content} className={styles.content} data-page={page}>
        {/* 插槽就位后才挂载队列页：历史区挂载时要能获取到自己的列表，滚动监听与按键才能接上 */}
        {page === 'queue' && historySlot && (
          <QueueList
            review={{ toggle: reviewSlot, history: historySlot }}
            head={(onMenu) => <RightCardHead onMenu={onMenu} />}
            active={!covered}
          />
        )}
        {page === 'bio' && biography}
        {page === 'info' && information?.content}
        {page === 'lyrics' && (
          <LyricsPreviewContext value={{ visible: preview.visible, pin: preview.pin }}>
            {lyrics}
          </LyricsPreviewContext>
        )}
      </div>
    </section>
  );
}
