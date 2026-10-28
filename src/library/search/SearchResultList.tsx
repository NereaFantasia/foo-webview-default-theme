import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCommand } from '../../nav/useCommand.ts';
import { useScrollFrame } from '../../table/useScrollFrame.ts';
import { useStickyViewport } from '../../table/useStickyViewport.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { searchOptionId } from './searchSuggestions.ts';
import styles from './SearchResultList.module.css';
import {
  activate as activateSelection,
  emptySelection,
  menuSelection,
  pruneSelection,
  selectAll,
  type Modifiers,
} from '../../kit/keyedSelection.ts';

/** 列表交给每一项的状态与回调；项自己决定画成行还是图块 */
export interface SearchListItemProps<T> {
  readonly id: string;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly position: number;
  readonly total: number;
  onActivate(item: T, play: boolean): void;
  onSelect(item: T, modifiers: Modifiers): void;
  onMenu(item: T, at: TablePoint): void;
}

export interface SearchResultListProps<T> {
  readonly items: readonly T[];
  keyOf(item: T): string;
  /**
   * 一格的宽与高，像素。`width` 为 null 时每行一项；否则按宽度能放几格就分几列，`stretch` 时各列平分整行，
   * 不然每列就是这个宽度、靠左排
   */
  readonly cell: {
    readonly width: number | null;
    readonly height: number;
    readonly stretch: boolean;
  };
  /** 回车时是起播还是打开 */
  playsOnEnter(item: T): boolean;
  renderItem(item: T, props: SearchListItemProps<T>): ReactNode;
  readonly scroller: HTMLElement | null;
  readonly label: string;
  /** 写进 `data-search-view`：列表、图块或在线结果的哪一类 */
  readonly view: string;
  readonly active: string | null;
  onActive(key: string | null): void;
  onActivate(item: T, play: boolean): void;
  onMenu(item: T, at: TablePoint, selection: readonly T[]): void;
  onAll(): Promise<readonly T[] | null>;
  /**
   * 列头：行跟着页面滚时吸在滚动元素的顶上，行的可见区从它下面开始，行不会从它底下透出来，所以它不用铺底
   */
  readonly header?: ReactNode;
}

export function SearchResultList<T>({
  items: hits,
  keyOf,
  cell,
  playsOnEnter,
  renderItem,
  scroller,
  label,
  view,
  active,
  onActive,
  onActivate,
  onMenu,
  onAll,
  header,
}: SearchResultListProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const order = useMemo(() => hits.map(keyOf), [hits, keyOf]);
  const [stored, setSelection] = useState(() => emptySelection<string>());
  const selection = pruneSelection(stored, order);
  if (selection !== stored) setSelection(selection);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const { scroller: scrolling, frame } = useScrollFrame(scroller, body, root);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !scroller) return;
    const measure = () =>
      setSize((last) => {
        const next = { width: element.clientWidth, height: scroller.clientHeight };
        return last.width === next.width && last.height === next.height ? last : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);
  const id = useId();
  const index = hits.findIndex((hit) => keyOf(hit) === active);
  const columns = cell.width === null ? 1 : Math.max(1, Math.floor(size.width / cell.width));
  const rowHeight = cell.height;
  const virtual = useVirtualizer({
    count: Math.ceil(hits.length / columns),
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    getItemKey: (at) => {
      const hit = hits[at * columns];
      return hit ? keyOf(hit) : at;
    },
    scrollMargin: frame.margin,
    scrollPaddingStart: frame.stickyTop,
    scrollPaddingEnd: frame.bottomInset,
    overscan: 5,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(index >= 0 ? [Math.floor(index / columns)] : []),
        ]),
      ].sort((a, b) => a - b),
  });
  const previous = useRef({ columns, rowHeight });
  useLayoutEffect(() => {
    const before = previous.current;
    if (before.columns === columns && before.rowHeight === rowHeight) return;
    previous.current = { columns, rowHeight };
    const first =
      Math.floor(Math.max(0, (scroller?.scrollTop ?? 0) - frame.margin) / before.rowHeight) *
      before.columns;
    virtual.measure();
    if (hits.length)
      virtual.scrollToIndex(Math.floor(Math.min(first, hits.length - 1) / columns), {
        align: 'start',
      });
  }, [columns, rowHeight, virtual, scroller, frame.margin, hits.length]);
  useStickyViewport(scrolling, viewport, strip, {
    ...frame,
    total: virtual.getTotalSize(),
    height: Math.max(0, size.height - frame.stickyTop),
  });
  const activate = useCallback(
    (hit: T, play: boolean) => {
      request.current++;
      onActive(keyOf(hit));
      root.current?.focus({ preventScroll: true });
      onActivate(hit, play);
    },
    [onActive, onActivate, keyOf],
  );
  const select = useCallback(
    (hit: T, modifiers: Modifiers) => {
      request.current++;
      const key = keyOf(hit);
      setSelection(activateSelection(selection, order, key, modifiers));
      onActive(key);
      root.current?.focus({ preventScroll: true });
    },
    [selection, order, onActive, keyOf],
  );
  const menu = useCallback(
    (hit: T, at: TablePoint) => {
      request.current++;
      const key = keyOf(hit);
      const picked = menuSelection(selection, order, key);
      const wanted = new Set(picked.targets);
      setSelection(picked.selection);
      onActive(key);
      root.current?.focus({ preventScroll: true });
      onMenu(
        hit,
        at,
        hits.filter((item) => wanted.has(keyOf(item))),
      );
    },
    [selection, order, hits, onActive, onMenu, keyOf],
  );
  const enabled = () =>
    document.activeElement === root.current && !root.current?.closest('[inert]');
  const go = (at: number, shift = false) => {
    const next = Math.max(0, Math.min(hits.length - 1, at));
    const hit = hits[next];
    if (hit) {
      select(hit, { ctrl: false, shift });
      virtual.scrollToIndex(Math.floor(next / columns), { align: 'auto' });
    }
  };
  useCommand({
    id: `${id}.all`,
    layer: 'widget',
    keys: [{ key: 'a', ctrl: true }],
    enabled,
    run: () => {
      const mine = ++request.current;
      void onAll().then((all) => {
        if (!all || mine !== request.current) return;
        const keys = all.map(keyOf);
        setSelection(selectAll(keys));
        if (index < 0) onActive(keys[0] ?? null);
      });
    },
  });
  useCommand({
    id: `${id}.extendDown`,
    layer: 'widget',
    keys: [{ key: 'ArrowDown', shift: true }],
    enabled,
    run: () => go(index < 0 ? 0 : index + columns, true),
  });
  useCommand({
    id: `${id}.extendUp`,
    layer: 'widget',
    keys: [{ key: 'ArrowUp', shift: true }],
    enabled,
    run: () => go(index < 0 ? hits.length - 1 : index - columns, true),
  });
  useCommand({
    id: `${id}.extendLeft`,
    layer: 'widget',
    keys: [{ key: 'ArrowLeft', shift: true }],
    enabled,
    run: () => go(index - 1, true),
  });
  useCommand({
    id: `${id}.extendRight`,
    layer: 'widget',
    keys: [{ key: 'ArrowRight', shift: true }],
    enabled,
    run: () => go(index + 1, true),
  });
  useCommand({
    id: `${id}.extendHome`,
    layer: 'widget',
    keys: [{ key: 'Home', shift: true }],
    enabled,
    run: () => go(0, true),
  });
  useCommand({
    id: `${id}.extendEnd`,
    layer: 'widget',
    keys: [{ key: 'End', shift: true }],
    enabled,
    run: () => go(hits.length - 1, true),
  });
  useCommand({
    id: `${id}.extendPageDown`,
    layer: 'widget',
    keys: [{ key: 'PageDown', shift: true }],
    enabled,
    run: () => go(index + Math.max(1, Math.floor(size.height / rowHeight)) * columns, true),
  });
  useCommand({
    id: `${id}.extendPageUp`,
    layer: 'widget',
    keys: [{ key: 'PageUp', shift: true }],
    enabled,
    run: () => go(index - Math.max(1, Math.floor(size.height / rowHeight)) * columns, true),
  });
  useCommand({
    id: `${id}.down`,
    layer: 'widget',
    keys: [{ key: 'ArrowDown' }],
    enabled,
    run: () => go(index < 0 ? 0 : index + columns),
  });
  useCommand({
    id: `${id}.up`,
    layer: 'widget',
    keys: [{ key: 'ArrowUp' }],
    enabled,
    run: () => go(index < 0 ? hits.length - 1 : index - columns),
  });
  useCommand({
    id: `${id}.left`,
    layer: 'widget',
    keys: [{ key: 'ArrowLeft' }],
    enabled,
    run: () => go(index - 1),
  });
  useCommand({
    id: `${id}.right`,
    layer: 'widget',
    keys: [{ key: 'ArrowRight' }],
    enabled,
    run: () => go(index + 1),
  });
  useCommand({
    id: `${id}.pageDown`,
    layer: 'widget',
    keys: [{ key: 'PageDown' }],
    enabled,
    run: () => go(index + Math.max(1, Math.floor(size.height / rowHeight)) * columns),
  });
  useCommand({
    id: `${id}.pageUp`,
    layer: 'widget',
    keys: [{ key: 'PageUp' }],
    enabled,
    run: () => go(index - Math.max(1, Math.floor(size.height / rowHeight)) * columns),
  });
  useCommand({
    id: `${id}.menu`,
    layer: 'widget',
    keys: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
    enabled,
    run: () => {
      const hit = hits[index];
      const node = document.getElementById(`${id}-${searchOptionId(active ?? '')}`);
      if (!hit || !node) return;
      const rect = node.getBoundingClientRect();
      menu(hit, {
        x: rect.left + 16,
        y: Math.max(rect.top, scroller?.getBoundingClientRect().top ?? 0) + 24,
      });
    },
  });
  useCommand({
    id: `${id}.home`,
    layer: 'widget',
    keys: [{ key: 'Home' }],
    enabled,
    run: () => go(0),
  });
  useCommand({
    id: `${id}.end`,
    layer: 'widget',
    keys: [{ key: 'End' }],
    enabled,
    run: () => go(hits.length - 1),
  });
  useCommand({
    id: `${id}.enter`,
    layer: 'widget',
    keys: [{ key: 'Enter' }],
    enabled,
    run: () => {
      const hit = hits[index];
      if (hit) activate(hit, playsOnEnter(hit));
    },
  });
  return (
    <div
      ref={root}
      role="listbox"
      aria-multiselectable
      aria-label={label}
      tabIndex={0}
      className={styles.root}
      aria-activedescendant={index >= 0 && active ? `${id}-${searchOptionId(active)}` : undefined}
      data-search-list
      data-search-view={view}
    >
      {header && <div className={styles.head}>{header}</div>}
      <div ref={body} style={{ height: virtual.getTotalSize() }}>
        <div ref={viewport} className={styles.viewport} style={{ top: frame.header }}>
          <div ref={strip} className={styles.strip}>
            {virtual.getVirtualItems().map((item) => (
              <div
                key={item.key}
                className={styles.item}
                style={{
                  top: item.start - frame.margin,
                  height: rowHeight,
                  gridTemplateColumns: `repeat(${columns}, ${
                    cell.width === null || cell.stretch ? 'minmax(0, 1fr)' : `${cell.width}px`
                  })`,
                }}
              >
                {hits.slice(item.index * columns, (item.index + 1) * columns).map((hit, offset) => {
                  const key = keyOf(hit);
                  return (
                    <Fragment key={key}>
                      {renderItem(hit, {
                        id: `${id}-${searchOptionId(key)}`,
                        selected: selection.selected.has(key),
                        focused: key === active,
                        position: item.index * columns + offset + 1,
                        total: hits.length,
                        onActivate: activate,
                        onSelect: select,
                        onMenu: menu,
                      })}
                    </Fragment>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
