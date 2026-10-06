import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCommand } from '../../nav/useCommand.ts';
import { useScrollFrame } from '../../table/useScrollFrame.ts';
import { useStickyViewport } from '../../table/useStickyViewport.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { SearchView } from './results/searchView.ts';
import { searchHitKey, type SearchHit } from './searchQuery.ts';
import { SearchResultRow } from './SearchResultRow.tsx';
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

export interface SearchResultListProps {
  readonly hits: readonly SearchHit[];
  readonly scroller: HTMLElement | null;
  readonly label: string;
  readonly active: string | null;
  readonly view: SearchView;
  onActive(key: string | null): void;
  onActivate(hit: SearchHit, play: boolean): void;
  onMenu(hit: SearchHit, at: TablePoint, selection: readonly SearchHit[]): void;
  onAll(): Promise<readonly SearchHit[] | null>;
}

export function SearchResultList({
  hits,
  scroller,
  label,
  active,
  view,
  onActive,
  onActivate,
  onMenu,
  onAll,
}: SearchResultListProps) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const order = useMemo(() => hits.map(searchHitKey), [hits]);
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
  const index = hits.findIndex((hit) => searchHitKey(hit) === active);
  const columns = view === 'grid' ? Math.max(1, Math.floor(size.width / 160)) : 1;
  const rowHeight = view === 'grid' ? 208 : 56;
  const virtual = useVirtualizer({
    count: Math.ceil(hits.length / columns),
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    getItemKey: (at) => {
      const hit = hits[at * columns];
      return hit ? searchHitKey(hit) : at;
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
    (hit: SearchHit, play: boolean) => {
      request.current++;
      onActive(searchHitKey(hit));
      root.current?.focus({ preventScroll: true });
      onActivate(hit, play);
    },
    [onActive, onActivate],
  );
  const select = useCallback(
    (hit: SearchHit, modifiers: Modifiers) => {
      request.current++;
      const key = searchHitKey(hit);
      setSelection(activateSelection(selection, order, key, modifiers));
      onActive(key);
      root.current?.focus({ preventScroll: true });
    },
    [selection, order, onActive],
  );
  const menu = useCallback(
    (hit: SearchHit, at: TablePoint) => {
      request.current++;
      const key = searchHitKey(hit);
      const picked = menuSelection(selection, order, key);
      const wanted = new Set(picked.targets);
      setSelection(picked.selection);
      onActive(key);
      root.current?.focus({ preventScroll: true });
      onMenu(
        hit,
        at,
        hits.filter((item) => wanted.has(searchHitKey(item))),
      );
    },
    [selection, order, hits, onActive, onMenu],
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
        const keys = all.map(searchHitKey);
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
      if (hit) activate(hit, hit.kind === 'track');
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
      <div ref={body} style={{ height: virtual.getTotalSize() }}>
        <div ref={viewport} className={styles.viewport}>
          <div ref={strip} className={styles.strip}>
            {virtual.getVirtualItems().map((item) => (
              <div
                key={item.key}
                className={styles.item}
                style={{
                  top: item.start - frame.margin,
                  height: rowHeight,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {hits.slice(item.index * columns, (item.index + 1) * columns).map((hit, offset) => {
                  const key = searchHitKey(hit);
                  return (
                    <SearchResultRow
                      key={key}
                      hit={hit}
                      id={`${id}-${searchOptionId(key)}`}
                      option
                      tile={view === 'grid'}
                      selected={selection.selected.has(key)}
                      focused={key === active}
                      position={item.index * columns + offset + 1}
                      total={hits.length}
                      onActivate={activate}
                      onSelect={select}
                      onMenu={menu}
                    />
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
