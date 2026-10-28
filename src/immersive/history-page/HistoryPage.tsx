import { Target20Regular } from '@fluentui/react-icons';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { useService } from '../../kit/useService.ts';
import { useStableCallback } from '../../kit/useStableCallback.ts';
import { QueueMenu, type QueueMenuTarget } from '../../playback/queue/QueueMenu.tsx';
import { pathOf } from '../../playback/queue/queueMenu.ts';
import { QueueRowHeightContext } from '../../playback/queue/queueRowHeight.ts';
import { QueueRow, type RowPoint } from '../../playback/queue/QueueRow.tsx';
import { queueKey } from '../../playback/queue/queueServices.ts';
import { queueReviewAtom } from '../../playback/queue/review/queueReview.ts';
import {
  reviewRowAt,
  type QueueReviewView,
  type ReviewTrack,
} from '../../playback/queue/review/queueReviewModel.ts';
import { useQueueReviewKeys } from '../../playback/queue/review/useQueueReviewKeys.ts';
import { useQueueVirtualRows } from '../../playback/queue/useQueueVirtualRows.ts';
import { ChipGroup, ChipKey } from '../scene/ColumnChips.tsx';
import { SideColumn } from '../scene/SideColumn.tsx';
import styles from './HistoryPage.module.css';

/** 历史行高规格（CSS 像素），与队列页对齐 */
export const HISTORY_ROW_HEIGHT = 56;

/** 触底吸附判定阈值（像素）；满足时新记录到达自动跟随滚动 */
const AT_BOTTOM_PX = 2;

interface HistoryPageProps {
  /** 容器顶部偏移量与有效高度，与封面列对齐 */
  readonly top: number;
  readonly height: number;
}

/**
 * 沉浸模式播放历史页
 *
 * 采用正序排列且默认贴底呈现最近已播曲目，仅渲染视口虚拟行，支持触底自动追加跟随与回溯滚动固定；
 * 顶部提供回位快捷键，行内支持重播、悬停评级与上下文菜单，配合键盘导航与顶部渐隐遮罩
 */
export function HistoryPage({ top, height }: HistoryPageProps) {
  const view = useAtomValueRawSync(queueReviewAtom);
  return (
    <QueueRowHeightContext value={HISTORY_ROW_HEIGHT}>
      <HistoryList view={view} top={top} height={height} />
    </QueueRowHeightContext>
  );
}

function HistoryList({ view, top, height }: HistoryPageProps & { readonly view: QueueReviewView }) {
  const t = useAtomValueRawSync(translateAtom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const services = useService(queueKey);
  const scroll = useRef<HTMLDivElement>(null);
  const viewport = useQueueVirtualRows(scroll, view.total, scroll);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<QueueMenuTarget | null>(null);
  useStickToBottom(scroll, view.total, viewport.virtualizer);
  const play = (row: ReviewTrack) => void services.commands.playHandle(row.track.handle);
  const openMenu = (row: ReviewTrack, at: RowPoint, number: number) => {
    const anchor = { key: row.key, kind: 'review' as const, number, track: row.track, row: null };
    setSelected(row.key);
    setMenu({ anchor, rows: [anchor], at, play: () => play(row) });
    void services.menu.prepare([pathOf(row.track)]);
  };
  useQueueReviewKeys({
    records: scroll,
    view,
    from: 0,
    select: setSelected,
    scroll: (index) => viewport.virtualizer.scrollToIndex(index, { align: 'auto' }),
    play,
    menu: openMenu,
    close: () => {},
  });
  // 保持行事件回调引用稳定以利用 Row memo 规避全列表重绘
  const rowOfKey = (key: string) => {
    const index = view.rows.findIndex((row) => row.key === key);
    const row = view.rows[index];
    return row ? { row, number: index + 1 } : null;
  };
  const rowPlay = useStableCallback((key: string) => {
    const found = rowOfKey(key);
    if (found) play(found.row);
  });
  const rowMenu = useStableCallback((key: string, point: RowPoint) => {
    const found = rowOfKey(key);
    if (found) openMenu(found.row, point, found.number);
  });
  const rowFocus = useStableCallback((key: string) => setSelected(key));
  const rowPointerDown = useStableCallback((event: PointerEvent<HTMLDivElement>, key: string) => {
    if (event.button !== 0) return;
    setSelected(key);
    event.currentTarget.focus({ preventScroll: true });
  });
  const rows = viewport.visible.map((slot) => reviewRowAt(view, slot.index));
  // 焦点漫游管理：Tab 键仅能聚焦选中行，无选中时默认落入首个可见行
  const tabKey = rows.find((row) => row && row.key === selected)?.key ?? rows.find(Boolean)?.key;
  const variables: CSSProperties & Record<`--${string}`, string> = {
    '--queue-number-width': `${Math.max(2, String(view.total).length)}ch`,
    '--queue-row-height': `${HISTORY_ROW_HEIGHT}px`,
  };
  const locate = () =>
    scroll.current?.scrollTo({
      top: scroll.current.scrollHeight,
      behavior: reduced ? 'auto' : 'smooth',
    });
  return (
    <SideColumn
      element="history"
      top={top}
      height={height}
      head={
        <ChipGroup>
          <ChipKey
            icon={<Target20Regular />}
            label={t('queue.review.locateLatest')}
            disabled={view.total === 0}
            onClick={locate}
          />
        </ChipGroup>
      }
      headLabel={t('queue.review.title')}
      scrollerRef={scroll}
      fadeEnd={false}
      style={variables}
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
            {viewport.visible.map((slot, at) => {
              const row = rows[at];
              if (!row) return null;
              return (
                <div
                  key={row.key}
                  className={styles.row}
                  data-queue-review-index={slot.index}
                  style={{ transform: `translateY(${slot.start - viewport.margin}px)` }}
                >
                  <QueueRow
                    kind="review"
                    rowKey={row.key}
                    number={slot.index + 1}
                    track={row.track}
                    selected={selected === row.key}
                    current={tabKey === row.key}
                    lifted={false}
                    onPlay={rowPlay}
                    onMenu={rowMenu}
                    onFocus={rowFocus}
                    onPointerDown={rowPointerDown}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <QueueMenu
        target={menu}
        isCurrent={() => view.rows.some((row) => row.key === menu?.anchor.key)}
        perform={(command) => void command()}
        onClose={() => setMenu(null)}
      />
    </SideColumn>
  );
}

/**
 * 视口底部吸附滚动管理
 *
 * 初始挂载时瞬移至底部；若处于触底状态，新记录到达时自动跟滚并同步虚拟化偏移量，上滑回溯时不打断浏览位置
 */
function useStickToBottom(
  scroll: RefObject<HTMLDivElement | null>,
  total: number,
  virtualizer: Pick<Virtualizer<HTMLElement, Element>, 'scrollToOffset'>,
): void {
  const following = useRef(true);
  useLayoutEffect(() => {
    const box = scroll.current;
    if (!box) return;
    const follow = () => {
      following.current = box.scrollHeight - box.clientHeight - box.scrollTop < AT_BOTTOM_PX;
    };
    box.addEventListener('scroll', follow, { passive: true });
    return () => box.removeEventListener('scroll', follow);
  }, [scroll]);
  useLayoutEffect(() => {
    const box = scroll.current;
    if (!box || !following.current) return;
    box.scrollTop = box.scrollHeight;
    virtualizer.scrollToOffset(box.scrollTop);
  }, [scroll, total, virtualizer]);
}
