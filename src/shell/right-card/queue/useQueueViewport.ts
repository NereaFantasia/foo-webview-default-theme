import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { useRightCard } from '../rightCardContext.ts';
import { upNextAtom } from './upNext.ts';
import { rowElement } from './useQueueKeys.ts';
import type { QueueList } from './useQueueList.ts';
import { useQueueVirtualRows } from './useQueueVirtualRows.ts';
export { QUEUE_ROW_HEIGHT } from './useQueueVirtualRows.ts';

/** 总数决定滚动空间，视口决定 DOM 和读取范围；不为离屏曲目创建元素或请求封面。 */
export function useQueueViewport(
  root: RefObject<HTMLElement | null>,
  list: QueueList,
  expanded = false,
  /** 当前曲目卡在视口顶上时的 scrollTop；前面那一段在它上方。 */
  home: () => number = () => 0,
  /** 当前卡正跟着置顶：这时阅读锚点不管，以置顶为准。 */
  following: () => boolean = () => false,
) {
  const { upNext } = useRightCard();
  const view = useAtomValueRawSync(upNextAtom);
  const hasRound = view.total > view.currentCount;
  const total = expanded ? view.total : view.currentCount;
  const viewport = useQueueVirtualRows(root, total + (hasRound ? 1 : 0));
  useQueueScrollAnchor(
    root,
    view.refreshing,
    home,
    () => Math.abs(viewport.measureMargin() - viewport.margin) < 1,
    following,
  );
  const offsetOf = (index: number) => index - (hasRound && index > view.currentCount ? 1 : 0);
  const { visible, virtualizer } = viewport;
  const [requested, requestFocus] = useState<{
    index: number;
    shift: boolean;
    version: number;
  } | null>(null);
  const first = offsetOf(visible[0]?.index ?? 0);
  const last = Math.min(total - 1, offsetOf(visible.at(-1)?.index ?? first));
  useEffect(() => {
    if (total && last >= first) void upNext.readRange(first, last);
  }, [upNext, first, last, view.version, view.refreshing, total]);
  useEffect(() => {
    const scroller = root.current?.parentElement;
    const cancel = () => requestFocus(null);
    scroller?.addEventListener('wheel', cancel, { passive: true });
    scroller?.addEventListener('pointerdown', cancel);
    return () => {
      scroller?.removeEventListener('wheel', cancel);
      scroller?.removeEventListener('pointerdown', cancel);
    };
  }, [root]);

  useLayoutEffect(() => {
    if (
      view.refreshing ||
      !requested ||
      requested.version !== view.version ||
      requested.index >= total
    )
      return;
    virtualizer.scrollToIndex(
      requested.index + (hasRound && requested.index >= view.currentCount ? 1 : 0),
      { align: 'auto' },
    );
    const row = list.upNext.find(
      (item) => item.number === list.queued.length + requested.index + 1,
    );
    if (!row) {
      void upNext.readRange(requested.index, requested.index);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = rowElement(row.key);
      if (!target || !root.current?.contains(document.activeElement)) return;
      list.activate(row.key, { ctrl: false, shift: requested.shift });
      target.focus({ preventScroll: true });
      requestFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    requested,
    list,
    upNext,
    virtualizer,
    view.version,
    view.refreshing,
    root,
    total,
    hasRound,
    view.currentCount,
  ]);

  return {
    ...viewport,
    offsetOf,
    total,
    isRoundHeader: (index: number) => hasRound && index === view.currentCount,
    navigate(pick: (index: number) => number, shift: boolean) {
      const current = list.current ? list.rowOf(list.current) : undefined;
      const position =
        requested?.version === view.version
          ? list.queued.length + requested.index
          : current
            ? current.number - 1
            : -1;
      const target = Math.max(0, Math.min(list.queued.length + total - 1, pick(position)));
      const queued = list.queued[target];
      if (queued) {
        requestFocus(null);
        list.activate(queued.key, { ctrl: false, shift });
        queueMicrotask(() => rowElement(queued.key)?.focus());
      } else if (!view.refreshing)
        requestFocus({ index: target - list.queued.length, shift, version: view.version });
    },
  };
}

interface ReadingAnchor {
  readonly key: string;
  readonly top: number;
}

/**
 * 刷新前后保住正在阅读的曲目。停在当前曲目卡（`home`）或更上面时不管：停在卡上维持卡在顶上，不追随旧队首；
 * 前面那一段由它自己跟随。
 */
function useQueueScrollAnchor(
  root: RefObject<HTMLElement | null>,
  refreshing: boolean,
  home: () => number,
  /** 行已按此刻的偏移排好；上方内容（前面那一段、当前卡）刚变了高时要等下一次提交。 */
  placed: () => boolean,
  following: () => boolean,
) {
  const previous = useRef(refreshing);
  const anchors = useRef<ReadingAnchor[]>([]);
  const scrollTop = useRef(0);
  const homeTop = useRef(0);
  const capture = useCallback(() => {
    const scroller = root.current?.parentElement;
    if (!scroller || !root.current) return;
    const bounds = scroller.getBoundingClientRect();
    scrollTop.current = scroller.scrollTop;
    homeTop.current = home();
    anchors.current = [
      ...root.current.querySelectorAll<HTMLElement>('[data-kind="upnext"]'),
    ].flatMap((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom
        ? [{ key: row.dataset.queueRow ?? '', top: rect.top }]
        : [];
    });
  }, [root, home]);
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement;
    if (!scroller) return;
    const changed = () => capture();
    scroller.addEventListener('scroll', changed, { passive: true });
    return () => scroller.removeEventListener('scroll', changed);
  }, [root, capture]);
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement;
    const settling = previous.current && !refreshing;
    // 行还按旧偏移排着，量出来的位移不准：先不补、不重记，偏移跟上后的那次提交（绘制之前）再补。
    if (settling && !placed()) return;
    if (scroller && settling && !following() && scrollTop.current > homeTop.current + 1) {
      for (const anchor of anchors.current) {
        const row = root.current?.querySelector<HTMLElement>(
          `[data-queue-row="${CSS.escape(anchor.key)}"]`,
        );
        if (!row) continue;
        const delta = row.getBoundingClientRect().top - anchor.top;
        scroller.scrollTop += delta;
        scroller.dataset.queueMotionScroll = String(scroller.scrollTop);
        break;
      }
    }
    previous.current = refreshing;
    capture();
  });
}
