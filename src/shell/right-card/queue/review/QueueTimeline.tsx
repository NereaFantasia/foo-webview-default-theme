import { ChevronDown16Regular, History16Regular } from '@fluentui/react-icons';
import { createPortal } from 'react-dom';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { translateAtom } from '../../../../i18n/locale.ts';
import { pluralAtom } from '../../../../i18n/plural.ts';
import { reducedMotionAtom } from '../../../../motion/reducedMotion.ts';
import { CURVE, DURATION_MS, motionDuration } from '../../../../motion/timing.ts';
import { useRightCard } from '../../rightCardContext.ts';
import { QueueRow, type RowPoint } from '../QueueRow.tsx';
import { QueueMenu, type QueueMenuTarget } from '../QueueMenu.tsx';
import { pathOf } from '../queueMenu.ts';
import { queueReviewAtom } from './queueReview.ts';
import { reviewRowAt, type ReviewTrack, type QueueReviewView } from './queueReviewModel.ts';
import { useQueueReviewKeys } from './useQueueReviewKeys.ts';
import { QUEUE_ROW_HEIGHT } from '../useQueueVirtualRows.ts';
import { useQueueReviewViewport } from './useQueueReviewViewport.ts';
import { useQueueReviewMotion } from './useQueueReviewMotion.ts';
import styles from './QueueTimeline.module.css';

/** 箭头那一条的高度，与样式里的 `.grow` 一致。 */
const QUEUE_REVIEW_ARROW_HEIGHT = 24;

interface TimelineVariables extends CSSProperties {
  '--queue-number-width': string;
}
interface RegionVariables extends CSSProperties {
  '--queue-review-height': string;
  '--queue-gutter': string;
}
interface QueueTimelineProps {
  /** 队列页的根；它的父元素是队列滚动区。 */
  readonly root: RefObject<HTMLElement | null>;
  readonly reviewSlot: HTMLElement | null;
  /** 分页栏与队列滚动区之间的插槽，历史区挂在这里，不随队列滚动。 */
  readonly historySlot: HTMLElement;
  readonly children: ReactNode;
  perform(command: () => Promise<boolean>): void;
  /** 从历史重播之前调：换过去之后队列页把当前卡置顶。 */
  onPlay(): void;
}

/**
 * 回看在固定高度内独立滚动，最近经过的一首紧挨队列；开合键留在工具条。历史区在队列滚动区上方、单独一块，
 * 铺一层底色和队列分开；队列怎么滚它都不动。记录多过平时露得下的行数时，底板底边出一个箭头，点了往下拉开、
 * 队列让出高度，箭头转向上，再点收回。
 */
export function QueueTimeline({
  root,
  reviewSlot,
  historySlot,
  children,
  perform,
  onPlay,
}: QueueTimelineProps) {
  const view = useAtomValueRawSync(queueReviewAtom);
  return (
    <QueueTimelineView
      root={root}
      reviewSlot={reviewSlot}
      historySlot={historySlot}
      perform={perform}
      onPlay={onPlay}
      view={view}
    >
      {children}
    </QueueTimelineView>
  );
}

function QueueTimelineView({
  root,
  reviewSlot,
  historySlot,
  children,
  perform,
  onPlay,
  view,
}: QueueTimelineProps & { readonly view: QueueReviewView }) {
  const services = useRightCard();
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const recordsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [grown, setGrown] = useState(false);
  const [gutter, setGutter] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<QueueMenuTarget | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const records = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const moving = useRef<HTMLDivElement>(null);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  useLayoutEffect(() => {
    const count = toggle.current?.lastElementChild;
    const fade = count?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motionDuration(DURATION_MS.faster, reduced),
      easing: CURVE.linear.timing,
    });
    return () => fade?.cancel();
  }, [view.total, reduced]);
  const holding = useRef(false);
  useLayoutEffect(() => {
    if (holding.current && !menu && document.activeElement === document.body) {
      (toggle.current ?? root.current)?.focus({ preventScroll: true });
      holding.current = false;
    }
  });
  // 历史区在滚动区外面，右边让出队列滚动条占的那一截，两块的右缘才对得齐。滚动区从自己这一层往上找：
  // 挂上时父组件的 ref 还没就位。
  useLayoutEffect(() => {
    const scroller = moving.current?.closest('[data-queue-page]')?.parentElement;
    if (!scroller) return;
    const measure = () => setGutter(scroller.offsetWidth - scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);
  const open = expanded && view.total > 0;
  const viewport = useQueueReviewViewport(records, historySlot, view, open, grown);
  const height = viewport.regionHeight;
  const motion = useQueueReviewMotion({ root, panel, records, arrow, open, listHeight: height });
  const play = (row: ReviewTrack) => {
    onPlay();
    perform(() => services.commands.playHandle(row.track.handle));
  };
  const openMenu = (row: ReviewTrack, at: RowPoint, number: number) => {
    const anchor = {
      key: row.key,
      kind: 'review' as const,
      number,
      track: row.track,
      row: null,
    };
    setSelected(row.key);
    setMenu({ anchor, rows: [anchor], at, play: () => play(row) });
    void services.menu.prepare([pathOf(row.track)]);
  };
  const variables: TimelineVariables = {
    '--queue-number-width': `${Math.max(2, String(view.total).length)}ch`,
  };
  useQueueReviewKeys({
    records,
    view,
    from: 0,
    select: setSelected,
    scroll: (index) => viewport.virtualizer.scrollToIndex(index, { align: 'auto' }),
    play,
    menu: openMenu,
    close: () => {
      toggle.current?.focus();
      motion.capture();
      setExpanded(false);
    },
  });
  const tabKey =
    viewport.visible
      .map((slot) => reviewRowAt(view, slot.index))
      .find((row) => row?.track && row.key === selected)?.key ??
    viewport.visible.map((slot) => reviewRowAt(view, slot.index)).find((row) => row?.track)?.key;
  const toggleLabel = `${t('queue.review.title')} · ${t(
    plural(view.total, 'queue.countOne', 'queue.count'),
    { count: view.total },
  )}`;
  const growLabel = t(grown ? 'queue.review.shrink' : 'queue.review.grow');
  const regionVariables: RegionVariables = {
    '--queue-review-height': `${height + (viewport.overflow ? QUEUE_REVIEW_ARROW_HEIGHT : 0)}px`,
    '--queue-gutter': `${gutter}px`,
  };
  return (
    <>
      {view.total > 0 &&
        reviewSlot &&
        createPortal(
          <button
            ref={toggle}
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={recordsId}
            aria-label={toggleLabel}
            title={toggleLabel}
            data-queue-review-toggle
            onClick={() => {
              if (records.current?.contains(document.activeElement)) toggle.current?.focus();
              motion.capture();
              // 每次打开都从平时的高度开始。
              if (!open) setGrown(false);
              setExpanded(!open);
            }}
          >
            <History16Regular />
            <span className={styles.count}>{view.total}</span>
          </button>,
          reviewSlot,
        )}
      {createPortal(
        <div
          className={styles.region}
          data-open={open || undefined}
          style={regionVariables}
          data-queue-review-region
        >
          <div
            ref={panel}
            className={styles.panel}
            style={{ display: motion.present ? undefined : 'none' }}
          >
            <div
              id={recordsId}
              ref={records}
              className={styles.records}
              data-queue-review-records
              onFocusCapture={() => {
                holding.current = true;
              }}
              onBlurCapture={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  !records.current?.contains(event.relatedTarget)
                )
                  holding.current = false;
              }}
              inert={!open}
              aria-hidden={!open}
              style={{ ...variables, height, opacity: open ? 1 : 0 }}
            >
              <div
                ref={viewport.element}
                className={styles.list}
                role="listbox"
                aria-label={t('queue.review.title')}
                style={{ height: viewport.height }}
              >
                <div ref={viewport.viewport} className={styles.viewport}>
                  <div ref={viewport.strip} className={styles.strip}>
                    {viewport.visible.map((slot) => {
                      const index = slot.index;
                      const row = reviewRowAt(view, index);
                      if (!row) return null;
                      return (
                        <div
                          key={row.key}
                          className={styles.row}
                          data-queue-review-index={index}
                          style={{
                            height: QUEUE_ROW_HEIGHT,
                            transform: `translateY(${slot.start - viewport.margin}px)`,
                          }}
                        >
                          <QueueRow
                            kind="review"
                            rowKey={row.key}
                            number={index + 1}
                            track={row.track}
                            selected={selected === row.key}
                            current={tabKey === row.key}
                            lifted={false}
                            openAlbum={services.deps.albumOpener(row.track)}
                            onPlay={() => play(row)}
                            onMenu={(_, at) => openMenu(row, at, index + 1)}
                            onFocus={() => setSelected(row.key)}
                            onPointerDown={(event) => {
                              if (event.button === 0) {
                                setSelected(row.key);
                                event.currentTarget.focus({ preventScroll: true });
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            {viewport.overflow && (
              <div ref={arrow} className={styles.grow} inert={!open}>
                <button
                  type="button"
                  className={styles.growKey}
                  aria-label={growLabel}
                  title={growLabel}
                  aria-expanded={grown}
                  aria-controls={recordsId}
                  data-grown={grown || undefined}
                  data-queue-review-grow
                  onClick={() => {
                    motion.capture();
                    setGrown(!grown);
                  }}
                >
                  <ChevronDown16Regular className={styles.growIcon} />
                </button>
              </div>
            )}
          </div>
        </div>,
        historySlot,
      )}
      <div ref={moving} className={styles.moving} data-queue-timeline-current>
        {children}
      </div>
      <QueueMenu
        target={menu}
        isCurrent={() => open && view.rows.some((row) => row.key === menu?.anchor.key)}
        perform={perform}
        onPlay={onPlay}
        onClose={() => setMenu(null)}
      />
    </>
  );
}
