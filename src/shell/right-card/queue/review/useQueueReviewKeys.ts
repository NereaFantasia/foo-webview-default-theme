import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react';
import { useCommand } from '../../../../nav/useCommand.ts';
import type { KeyChord } from '../../../../nav/commandRegistry.ts';
import type { RowPoint } from '../QueueRow.tsx';
import { reviewRowAt, type QueueReviewView, type ReviewTrack } from './queueReviewModel.ts';

interface ReviewKeysOptions {
  readonly records: RefObject<HTMLElement | null>;
  readonly view: QueueReviewView;
  readonly from: number;
  select(key: string): void;
  scroll(index: number): void;
  play(row: ReviewTrack): void;
  menu(row: ReviewTrack, point: RowPoint, number: number): void;
  close(): void;
}

/** 回看只支持浏览与重播；移除、排序和队列撤销不会借用另一段的选择。 */
export function useQueueReviewKeys(options: ReviewKeysOptions) {
  const scope = useId();
  const [requested, request] = useState<string | null>(null);
  const { records, view, from } = options;
  useEffect(() => {
    const box = records.current;
    const cancel = () => request(null);
    box?.addEventListener('wheel', cancel, { passive: true });
    box?.addEventListener('pointerdown', cancel);
    return () => {
      box?.removeEventListener('wheel', cancel);
      box?.removeEventListener('pointerdown', cancel);
    };
  }, [records]);
  const inside = () => {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      active.dataset.kind === 'review' &&
      (records.current?.contains(active) ?? false)
    );
  };
  const focused = () => {
    const element = document.activeElement?.closest<HTMLElement>('[data-queue-review-index]');
    const index = Number(element?.dataset.queueReviewIndex);
    const row = Number.isInteger(index) ? reviewRowAt(view, index) : null;
    return row ? { row, index } : null;
  };
  useLayoutEffect(() => {
    if (requested === null) return;
    const index = view.rows.findIndex((row) => row.key === requested);
    if (index < from || records.current?.inert) {
      request(null);
      return;
    }
    options.scroll(index - from);
    const row = reviewRowAt(view, index);
    if (!row) return;
    const frame = requestAnimationFrame(() => {
      const element = records.current?.querySelector<HTMLElement>(`[data-queue-row="${row.key}"]`);
      if (element) {
        options.select(row.key);
        element.focus({ preventScroll: true });
        request(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [requested, options, view, records, from]);
  const step = (name: string, key: string, pick: (index: number) => number) => ({
    id: `queue.review.${name}.${scope}`,
    layer: 'widget' as const,
    keys: [{ key }],
    enabled: inside,
    run: () => {
      const pending = view.rows.findIndex((row) => row.key === requested);
      const index = Math.max(
        from,
        Math.min(view.total - 1, pick(pending >= 0 ? pending : (focused()?.index ?? from))),
      );
      request(reviewRowAt(view, index)?.key ?? null);
    },
  });
  useCommand(step('up', 'ArrowUp', (i) => i - 1));
  useCommand(step('down', 'ArrowDown', (i) => i + 1));
  useCommand(step('first', 'Home', () => from));
  useCommand(step('last', 'End', () => view.total - 1));
  const command = (name: string, keys: readonly KeyChord[], run: () => void) => ({
    id: `queue.review.${name}.${scope}`,
    layer: 'widget' as const,
    keys,
    enabled: inside,
    run,
  });
  useCommand(
    command('play', [{ key: 'Enter' }], () => {
      const item = focused();
      if (item) options.play(item.row);
    }),
  );
  useCommand(
    command('menu', [{ key: 'ContextMenu' }, { key: 'F10', shift: true }], () => {
      const item = focused();
      const box = document.activeElement?.getBoundingClientRect();
      if (item && box)
        options.menu(item.row, { x: box.left + box.width / 2, y: box.bottom }, item.index + 1);
    }),
  );
  useCommand(command('close', [{ key: 'ArrowLeft' }], options.close));
}
