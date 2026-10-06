import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { edgeStep, passedThreshold, slotAt, type RowEdges } from './playlistReorder.ts';

/** 拖动中：拖的是哪一张（GUID）、此刻的插入位（0…n）。 */
export interface PlaylistDrag {
  readonly guid: string;
  readonly slot: number;
}

export interface PlaylistReorderOptions {
  /** 清单所在的滚动区；各行按 `[data-playlist-entry]` 找，文档顺序就是插入位的顺序。 */
  readonly scroller: RefObject<HTMLElement | null>;
  /** 此刻能不能起拖：过滤时看不见全部列表、改名时行在输入态，都不行。 */
  readonly enabled: boolean;
  /** 清单的签名：拖动途中变了（别处新建、删除、重排）就取消，按旧清单算的插入位已经对不上。 */
  readonly signature: string;
  /** 松手时交出去；落在原位与否由接的一方判断。 */
  drop(guid: string, slot: number): void;
}

export interface PlaylistReorder {
  readonly drag: PlaylistDrag | null;
  /** 行上按下指针时调。 */
  press(event: ReactPointerEvent, guid: string): void;
  /** 取消进行中的拖动；拖动层的 Esc 调它。 */
  cancel(): void;
}

/** 拖到边缘时每隔这么久滚一行，毫秒。 */
const EDGE_STEP_MS = 100;
const ROW = '[data-playlist-entry]';

function rowEdges(list: HTMLElement): RowEdges[] {
  return [...list.querySelectorAll<HTMLElement>(ROW)].map((row) => {
    const box = row.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
}

function inside(list: HTMLElement, x: number, y: number): boolean {
  const box = list.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/**
 * 拖动重排的手势：只认鼠标左键、不带修饰键；按下后移出阈值才算拖，没过线就松手照常是单击。
 *
 * 过线之前不抢指针：捕获会把松手那一下改投给捕获元素，单击就坏了。过线之后把指针捕获到 `document.body`，
 * 松手在窗口外也收得到，而 `click` 落在按下与松开两处的公共祖先上，不会再触发行的单击。
 * 指针停在滚动区上下沿附近或越出时按定时器一行一行滚，插入位跟着重算。窗口失焦、`pointercancel`、
 * 丢了捕获、清单签名变了都算取消；松手在滚动区外同样不交出去。
 *
 * 过线之后的取消（Esc、失焦、清单变了）只收起拖动的样子，捕获留到松手：松手那一下仍落在 body 上，
 * 按下与松开在同一行时也不会合成一次单击、打开那张列表。
 */
export function usePlaylistReorder(options: PlaylistReorderOptions): PlaylistReorder {
  const [drag, setDrag] = useState<PlaylistDrag | null>(null);
  const latest = useRef(options);
  const stop = useRef<(() => void) | null>(null);
  const abortDrag = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => () => stop.current?.(), []);

  function press(event: ReactPointerEvent, guid: string): void {
    const modified = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
    if (event.button !== 0 || event.pointerType !== 'mouse' || modified) return;
    if (!latest.current.enabled) return;
    stop.current?.();
    const origin = { x: event.clientX, y: event.clientY };
    const pointer = event.pointerId;
    const signature = latest.current.signature;
    const body = document.body;
    let dragging = false;
    let canceled = false;
    let lastY = origin.y;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stale = () => latest.current.signature !== signature;

    const aim = () => {
      const list = latest.current.scroller.current;
      if (list) setDrag({ guid, slot: slotAt(lastY, rowEdges(list)) });
    };
    const abort = () => {
      if (!dragging) {
        finish();
        return;
      }
      canceled = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      setDrag(null);
    };
    const scrollAtEdge = () => {
      const list = latest.current.scroller.current;
      if (!list || stale()) {
        abort();
        return;
      }
      const box = list.getBoundingClientRect();
      const rowHeight = list.querySelector(ROW)?.getBoundingClientRect().height ?? 0;
      const step = rowHeight > 0 ? edgeStep(lastY, box.top, box.bottom, rowHeight) : 0;
      if (step === 0) return;
      list.scrollTop += step * rowHeight;
      aim();
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      if ((next.buttons & 1) === 0) {
        finish();
        return;
      }
      if (canceled) return;
      if (stale()) {
        abort();
        return;
      }
      if (!dragging) {
        if (!passedThreshold(origin, { x: next.clientX, y: next.clientY })) return;
        dragging = true;
        body.setPointerCapture(pointer);
        body.addEventListener('lostpointercapture', cancelOn);
        timer = setInterval(scrollAtEdge, EDGE_STEP_MS);
      }
      next.preventDefault();
      lastY = next.clientY;
      aim();
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      if (canceled) {
        finish();
        return;
      }
      const list = latest.current.scroller.current;
      const slot =
        dragging && list && inside(list, next.clientX, next.clientY)
          ? slotAt(next.clientY, rowEdges(list))
          : null;
      const current = !stale();
      finish();
      if (slot !== null && current) latest.current.drop(guid, slot);
    };
    const cancelOn = (next: PointerEvent) => {
      if (next.pointerId === pointer) finish();
    };
    function finish(): void {
      if (stop.current !== finish) return;
      stop.current = null;
      abortDrag.current = null;
      if (timer !== undefined) clearInterval(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelOn);
      window.removeEventListener('blur', abort);
      body.removeEventListener('lostpointercapture', cancelOn);
      if (body.hasPointerCapture(pointer)) body.releasePointerCapture(pointer);
      setDrag(null);
    }

    stop.current = finish;
    abortDrag.current = abort;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelOn);
    window.addEventListener('blur', abort);
  }

  return { drag, press, cancel: () => abortDrag.current?.() };
}
