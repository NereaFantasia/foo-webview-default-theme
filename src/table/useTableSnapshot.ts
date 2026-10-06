import { useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { focusLost } from '../kit/focusLost.ts';
import type { SnapshotSlot } from '../nav/navHistory.ts';
import { PageEntryContext, usePageSnapshot } from '../nav/usePageSnapshot.ts';
import { createScrollRestore } from '../kit/scrollRestore.ts';
import type { TrackTableHandle } from './TrackTable.tsx';

/** 一张表离开时记下、回来时交还的样子。选中不在里面，回来不恢复。 */
export interface TableView<E> {
  readonly scrollTop: number;
  /** 焦点行的条目键。 */
  readonly focus: string | null;
  /** 调用方另要记的，例如排序。 */
  readonly extra: E;
}

export interface TableSnapshotOptions<E> {
  readonly handle: RefObject<TrackTableHandle | null>;
  /** 此刻的条目流，只按身份比：交还的滚动挂着等它排定，见 `createScrollRestore`。 */
  readonly items: object;
  /** 要的数据到齐了：这时才登记快照，回来时交还的滚动落在已取回的数据上。 */
  readonly ready: boolean;
  readonly extra: () => E;
  /** 交还的那一刻调，例如把排序换回去。 */
  readonly apply?: (extra: E) => void;
  /** 条目流是不是已经按快照排好了（排序换回去了）；不给就是交还当时就算排好。 */
  readonly matches?: (extra: E) => boolean;
}

/** 这几种输入是用户在滚动区上动了：挂着的滚动作罢。捕获阶段听，行里的按钮上的也算。 */
const USER_INPUT = ['keydown', 'pointerdown', 'wheel'] as const;
const LISTEN: AddEventListenerOptions = { capture: true, passive: true };

/**
 * 表格所在页面的快照：离开这条历史记录时记下滚动、焦点行与调用方要的其余几项，回来时交还。交还的那份先收着，
 * 等条目流按快照排好再落焦点与滚动；滚动还可能要等条目流再变一次，用户先动了就作罢。落下时 DOM 焦点没有
 * 着落（旧页面带着它卸掉了）就交给表格，键盘接得着。
 */
export function useTableSnapshot<E>(
  slot: SnapshotSlot<TableView<E>>,
  options: TableSnapshotOptions<E>,
): void {
  const { handle, items, ready } = options;
  const [restore] = useState(() => createScrollRestore());
  const waiting = useRef<TableView<E> | null>(null);
  /** 挂着「用户动了」监听的那个滚动元素。 */
  const watched = useRef<HTMLElement | null>(null);
  const scroller = () => handle.current?.scrollElement() ?? null;
  // 交还了、还没落下就又离开时，原样记回去。
  const capture = (): TableView<E> =>
    waiting.current ?? {
      scrollTop: scroller()?.scrollTop ?? 0,
      focus: handle.current?.focusedKey() ?? null,
      extra: options.extra(),
    };

  usePageSnapshot(
    slot,
    {
      capture,
      restore(view) {
        waiting.current = view;
        options.apply?.(view.extra);
      },
    },
    ready,
  );

  const [cancel] = useState(() => () => restore.cancel());
  useLayoutEffect(() => {
    const view = waiting.current;
    if (view && ready && (options.matches?.(view.extra) ?? true)) {
      waiting.current = null;
      handle.current?.setFocusKey(view.focus);
      if (view.focus !== null && focusLost()) handle.current?.focus();
      restore.hold(view.scrollTop, items);
    }
    const element = scroller();
    if (element !== watched.current) {
      for (const type of USER_INPUT) watched.current?.removeEventListener(type, cancel, LISTEN);
      for (const type of USER_INPUT) element?.addEventListener(type, cancel, LISTEN);
      watched.current = element;
    }
    if (element) restore.commit(element, items);
  });
  useLayoutEffect(
    () => () => {
      for (const type of USER_INPUT) watched.current?.removeEventListener(type, cancel, LISTEN);
      watched.current = null;
    },
    [cancel],
  );

  // 页面还在、表格先卸掉（专辑页从列表形态切到封面墙）时，把此刻的样子记回槽里：之后回到这条记录时表格
  // 不在，这个槽没有交还，再切回来挂上时交还的该是切走时的样子，而不是更早离开这条记录时记下的那份。
  // 数据没到齐时记下的是空样子，不记。
  const entry = useContext(PageEntryContext);
  const leave = useRef({ ready, capture });
  useLayoutEffect(() => {
    leave.current = { ready, capture };
  });
  useLayoutEffect(
    () => () => {
      if (entry && leave.current.ready) slot.values.set(entry, leave.current.capture());
    },
    [entry, slot],
  );
}
