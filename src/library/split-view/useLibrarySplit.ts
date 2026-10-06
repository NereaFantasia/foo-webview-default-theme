import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { useCommand } from '../../nav/useCommand.ts';
import { browserStorage, storedRecord } from '../../kit/localPref.ts';
import { useElementWidth } from '../../kit/useElementWidth.ts';

interface SplitSizes {
  readonly width: number;
  readonly height: number;
}

/** 一个区域一个键，缺省宽度由调用方给，所以不用 `defineLocalPref`；读不了、坏了的那一项按缺省。 */
function readSizes(key: string, width: number): SplitSizes {
  let saved: Readonly<Record<string, unknown>> = {};
  try {
    saved = storedRecord(browserStorage()?.getItem(key) ?? null);
  } catch {
    // 存储读不了：两项都按缺省。
  }
  const { width: savedWidth, height } = saved;
  return {
    width: typeof savedWidth === 'number' && Number.isFinite(savedWidth) ? savedWidth : width,
    height: typeof height === 'number' && Number.isFinite(height) ? height : 220,
  };
}

export function useLibrarySplit(area: 'artists' | 'genres' | 'folders', defaultWidth = 280) {
  const key = `default-theme.${area}-split.v1`;
  const id = useId();
  const separator = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(() => readSizes(key, defaultWidth));
  const [available, setAvailable] = useState(0);
  const frame = useRef(0);
  const measure = useElementWidth<HTMLElement>((width) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setAvailable(width));
  });
  const compact = available < 880;
  const maximum = Math.max(160, Math.min(400, available - 440));
  const minimum = Math.min(200, maximum);
  const clamp = (value: number) => Math.max(minimum, Math.min(value, maximum));
  const size = clamp(sizes.width);
  const drag = useRef<{
    readonly start: number;
    readonly size: number;
    readonly preferred: number;
    readonly target: HTMLDivElement;
    readonly pointerId: number;
  } | null>(null);
  const set = (width: number) => setSizes((old) => ({ ...old, width: clamp(width) }));
  function finish(cancel: boolean) {
    const previous = drag.current;
    drag.current = null;
    if (!previous) return;
    if (cancel) setSizes((old) => ({ ...old, width: previous.preferred }));
    if (previous.target.hasPointerCapture(previous.pointerId))
      previous.target.releasePointerCapture(previous.pointerId);
  }
  useEffect(() => {
    if (compact) finish(true);
  }, [compact]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      const previous = drag.current;
      drag.current = null;
      if (previous?.target.hasPointerCapture(previous.pointerId))
        previous.target.releasePointerCapture(previous.pointerId);
    },
    [],
  );
  useEffect(() => {
    try {
      browserStorage()?.setItem(key, JSON.stringify(sizes));
    } catch {
      /* 存储不可用时仍可拖动。 */
    }
  }, [key, sizes]);
  useCommand({
    id: `library.split.cancel.${id}`,
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => drag.current !== null,
    run: () => finish(true),
  });
  useCommand({
    id: `library.split.decrease.${id}`,
    layer: 'widget',
    keys: [{ key: 'ArrowLeft' }],
    enabled: () => !compact && separator.current === document.activeElement,
    run: () => set(size - 16),
  });
  useCommand({
    id: `library.split.increase.${id}`,
    layer: 'widget',
    keys: [{ key: 'ArrowRight' }],
    enabled: () => !compact && separator.current === document.activeElement,
    run: () => set(size + 16),
  });
  return {
    measure,
    compact,
    size,
    separator,
    minimum,
    maximum,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !event.isPrimary || compact || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        start: event.clientX,
        size,
        preferred: sizes.width,
        target: event.currentTarget,
        pointerId: event.pointerId,
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const previous = drag.current;
      if (!previous || previous.pointerId !== event.pointerId || compact) return;
      set(previous.size + event.clientX - previous.start);
    },
    onPointerUp: () => finish(false),
    onPointerCancel: () => finish(true),
  };
}
