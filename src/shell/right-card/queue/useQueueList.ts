import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState } from 'react';
import {
  activate,
  emptySelection,
  menuSelection,
  orderedSelection,
  pruneSelection,
  selectAll,
  type KeyedSelection,
  type Modifiers,
} from '../../../kit/keyedSelection.ts';
import { queueViewAtom } from './queueState.ts';
import { upNextAtom, type UpNextTrack, type UpNextRow } from './upNext.ts';
import { useRightCard } from '../rightCardContext.ts';
import { activateQueueIndex } from './queueIndexSelection.ts';

export type QueueRowKind = 'queued' | 'upnext' | 'earlier' | 'review';

export interface QueueListRow {
  /** 「队列」段用条目的身份；「接下来」段加前缀，免得与队列里同一首撞上。 */
  readonly key: string;
  readonly kind: QueueRowKind;
  /** 第几个播，从 1 起，两段接着数。 */
  readonly number: number;
  readonly track: UpNextTrack;
  /** 「接下来」这一行在来源列表里的行号；「队列」段为 null。 */
  readonly row: number | null;
}

const UP_NEXT_PREFIX = 'next:';

export interface QueueList {
  readonly queued: readonly QueueListRow[];
  readonly upNext: readonly QueueListRow[];
  readonly rows: readonly QueueListRow[];
  isSelected(row: QueueListRow): boolean;
  /** 键盘焦点停的那一行，也是列表里唯一能 Tab 进来的一行。 */
  readonly current: string | null;
  setCurrent(key: string | null): void;
  /** 单击或方向键落到这一行；修饰键的语义同表格。选中只在一段之内，跨段时当没按修饰键。 */
  activate(key: string, modifiers: Modifiers): void;
  /** 全选焦点所在段；「接下来」按逻辑位置选取，包含尚未读取的行。 */
  selectAll(): void;
  /** 右键落在这一行：答菜单作用于哪几行（按列表顺序，都在同一段）。 */
  menuTargets(key: string): Promise<QueueListRow[] | null>;
  /** 「队列」段里选中的几行；没有时为焦点那一行（它在「队列」段时）。 */
  queuedTargets(): QueueListRow[];
  rowOf(key: string): QueueListRow | undefined;
}

/**
 * 队列页的列表：「队列」段在前、「接下来」在后，键盘上下穿过两段。选中与焦点按行的身份记，队首被取走、
 * 别处改了队列时，看不见的行从选中里去掉；焦点那一行没了就落到原来位置上的那一行。
 */
export function useQueueList(visibleTotal = Infinity): QueueList {
  const services = useRightCard();
  const { entries } = useAtomValueRawSync(queueViewAtom);
  const upNext = useAtomValueRawSync(upNextAtom);
  const [stored, setSelection] = useState(() => emptySelection<string>());
  const [focus, setFocus] = useState<{ row: QueueListRow; version: number; offset: number } | null>(
    null,
  );
  const [nextStored, setNextSelection] = useState<{
    version: number;
    selection: KeyedSelection<number>;
  } | null>(null);
  const nextSelection =
    nextStored?.version === upNext.version ? nextStored.selection : emptySelection<number>();
  const nextRow = (item: UpNextRow): QueueListRow => ({
    key: `${UP_NEXT_PREFIX}${item.key}`,
    kind: 'upnext',
    number: entries.length + item.offset + 1,
    track: item.track,
    row: item.row,
  });

  const { queued, next, rows, order } = useMemo(() => {
    const queuedRows = entries.map((entry, index): QueueListRow => ({
      key: entry.key,
      kind: 'queued',
      number: index + 1,
      track: entry.track,
      row: null,
    }));
    const nextRows = upNext.rows
      .filter((item) => item.offset < visibleTotal)
      .map((item): QueueListRow => ({
        key: `${UP_NEXT_PREFIX}${item.key}`,
        kind: 'upnext',
        number: entries.length + item.offset + 1,
        track: item.track,
        row: item.row,
      }));
    const all = [...queuedRows, ...nextRows];
    return {
      queued: queuedRows,
      next: nextRows,
      rows: all,
      order: queuedRows.map((row) => row.key),
    };
  }, [entries, upNext.rows, visibleTotal]);

  const selection = pruneSelection(stored, order);
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  // 焦点只保留一份曲目快照；离屏回收 DOM 后仍知道键盘应从哪个逻辑位置继续。
  const focused = !focus
    ? undefined
    : focus.row.kind === 'upnext'
      ? focus.version === upNext.version && focus.offset < visibleTotal
        ? { ...focus.row, number: entries.length + focus.offset + 1 }
        : undefined
      : (byKey.get(focus.row.key) ?? queued[Math.min(focus.offset, queued.length - 1)] ?? next[0]);
  const current = focused?.key ?? null;
  const rowOf = (key: string) => byKey.get(key) ?? (focused?.key === key ? focused : undefined);
  const remember = (row: QueueListRow) =>
    setFocus({
      row,
      version: upNext.version,
      offset: row.number - 1 - (row.kind === 'upnext' ? queued.length : 0),
    });

  return {
    queued,
    upNext: next,
    rows,
    isSelected: (row) =>
      row.kind === 'queued'
        ? selection.selected.has(row.key)
        : nextSelection.selected.has(row.number - queued.length - 1),
    current,
    setCurrent(key) {
      const row = key ? rowOf(key) : undefined;
      if (row) remember(row);
      else setFocus(null);
    },
    activate(key, modifiers) {
      const row = rowOf(key);
      if (!row || (row.kind === 'upnext' && upNext.refreshing)) return;
      if (row.kind === 'queued') {
        setSelection(activate(selection, order, key, modifiers));
        setNextSelection(null);
      } else {
        setNextSelection({
          version: upNext.version,
          selection: activateQueueIndex(nextSelection, row.number - queued.length - 1, modifiers),
        });
        setSelection(emptySelection());
      }
      remember(row);
    },
    selectAll() {
      if (focused?.kind === 'upnext') {
        if (upNext.refreshing) return;
        const count = Math.min(visibleTotal, upNext.total);
        setNextSelection({
          version: upNext.version,
          selection: selectAll(Array.from({ length: count }, (_, index) => index)),
        });
        setSelection(emptySelection());
      } else {
        setSelection(selectAll(order));
        setNextSelection(null);
      }
    },
    async menuTargets(key) {
      const row = rowOf(key);
      if (!row || (row.kind === 'upnext' && upNext.refreshing)) return null;
      if (row.kind === 'upnext') {
        const offset = row.number - queued.length - 1;
        const picked = nextSelection.selected.has(offset)
          ? nextSelection
          : activateQueueIndex(nextSelection, offset, { ctrl: false, shift: false });
        setNextSelection({ version: upNext.version, selection: picked });
        setSelection(emptySelection());
        const answer = await services.upNext.readSelection(
          [...picked.selected].filter((offset) => offset < visibleTotal),
          upNext.version,
        );
        return answer?.map(nextRow) ?? null;
      }
      const picked = menuSelection(selection, order, key);
      setSelection(picked.selection);
      setNextSelection(null);
      return picked.targets
        .map((target) => byKey.get(target))
        .filter((row): row is QueueListRow => row !== undefined && row.kind === 'queued');
    },
    queuedTargets() {
      const picked = orderedSelection(selection, order)
        .map((key) => byKey.get(key))
        .filter((row): row is QueueListRow => row?.kind === 'queued');
      if (picked.length > 0) return picked;
      const focused = current ? byKey.get(current) : undefined;
      return focused?.kind === 'queued' ? [focused] : [];
    },
    rowOf,
  };
}
