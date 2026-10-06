import { Button, Spinner } from '@fluentui/react-components';
import { ChevronRight16Regular, Folder20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  useImperativeHandle,
  useRef,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { translateAtom } from '../../../i18n/locale.ts';
import {
  activate,
  emptySelection,
  menuSelection,
  pruneSelection,
  selectAll,
  type Modifiers,
} from '../../../kit/keyedSelection.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { foldersFocusAtom, foldersKey } from '../foldersServices.ts';
import { foldersFilterAtom } from './foldersFilter.ts';
import {
  foldersSelection,
  foldersSubjects,
  foldersVisible,
  type FolderNode,
} from './foldersModel.ts';
import { foldersTreeAtom } from './foldersTree.ts';
import { useFoldersKeys } from './useFoldersKeys.ts';
import { useFoldersTreeMotion } from './useFoldersTreeMotion.ts';
import styles from './FoldersTree.module.css';
import { useService } from '../../../kit/useService.ts';

/** 每行的高，像素，与样式里 `.row` 的高一致。 */
const ROW_HEIGHT = 40;

export interface FoldersTreeProps {
  readonly active: boolean;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly handle: RefObject<FoldersTreeHandle | null>;
  onMenu(nodes: readonly FolderNode[], point: TablePoint): void;
  onPlay(node: FolderNode): void;
}
export interface FoldersTreeHandle {
  focusedKey(): string | null;
  setFocusKey(key: string | null): void;
}
export function FoldersTree({ scroll, handle, onMenu, onPlay, active }: FoldersTreeProps) {
  const folders = useService(foldersKey);
  const state = useAtomValueRawSync(foldersTreeAtom);
  const filter = useAtomValueRawSync(foldersFilterAtom);
  const selectedFocus = useAtomValueRawSync(foldersFocusAtom);
  const t = useAtomValueRawSync(translateAtom);
  const id = useId();
  const [selection, setSelection] = useState(emptySelection<string>);
  const [focus, setFocus] = useState<string | null>(null);
  const followed = useRef<string | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  useImperativeHandle(handle, () => ({ focusedKey: () => focus, setFocusKey: setFocus }), [focus]);
  const rows = useMemo(
    () => foldersVisible(state.roots, state.nodes, state.children, state.expanded, filter.allowed),
    [state, filter.allowed],
  );
  const order = useMemo(() => rows.map(({ node }) => node.key), [rows]);
  const selectable = useMemo(
    () =>
      foldersVisible(
        state.roots,
        state.nodes,
        state.children,
        new Set(state.nodes.keys()),
        filter.allowed,
      ).map(({ node }) => node.key),
    [state, filter.allowed],
  );
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => order[index] ?? index,
    overscan: 6,
  });
  const ready = active && state.status === 'ready' && filter.status !== 'loading';
  const treeMotion = useFoldersTreeMotion({
    layer,
    scroll,
    rows,
    tree: state,
    scope: `${state.generation}:${filter.text}`,
    active: ready,
    rowHeight: ROW_HEIGHT,
  });
  useLayoutEffect(() => {
    if (!ready) return;
    setSelection((current) =>
      pruneSelection(
        current,
        [...state.nodes.keys()].filter((key) => !filter.allowed || filter.allowed.has(key)),
      ),
    );
    const selectedKeys = selectedFocus ? foldersSelection(selectedFocus) : [];
    const first =
      selectedKeys.find((key) => order.includes(key)) ??
      selectedKeys.find((key) => state.nodes.has(key));
    if (selectedFocus !== followed.current && first) {
      followed.current = selectedFocus;
      setFocus(first);
      setSelection({
        selected: new Set(selectedKeys),
        anchor: { key: first, at: order.indexOf(first) },
      });
      return;
    }
    setFocus((current) => {
      if (current && order.includes(current)) return current;
      let parent = current ? state.nodes.get(current)?.parent : null;
      while (parent && !order.includes(parent)) parent = state.nodes.get(parent)?.parent;
      return parent ?? order[0] ?? null;
    });
  }, [ready, order, selectedFocus, focus, state.nodes, filter.allowed]);
  function choose(key: string, modifiers: Modifiers, preview = true, visit = false) {
    if (!ready) return;
    if (visit && !modifiers.ctrl && !modifiers.shift) {
      void folders.visit(key);
      followed.current = key;
      setFocus(key);
      setSelection(activate(selection, order, key, modifiers));
      return;
    }
    setFocus(key);
    if (preview) {
      const next = activate(selection, order, key, modifiers);
      setSelection(next);
      const nodes = selectable
        .filter((value) => next.selected.has(value))
        .flatMap((value) => state.nodes.get(value) ?? []);
      followed.current = foldersSubjects(nodes);
      folders.selectMany(nodes, 100);
    }
    const index = order.indexOf(key);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }
  function menu(key: string, point?: TablePoint) {
    if (!ready) return;
    const next = menuSelection(selection, selectable, key);
    setSelection(next.selection);
    setFocus(key);
    const targets = next.targets.flatMap((target) => state.nodes.get(target) ?? []);
    followed.current = foldersSubjects(targets);
    folders.selectMany(targets);
    const box = scroll.current?.getBoundingClientRect();
    onMenu(targets, point ?? { x: (box?.x ?? 0) + 48, y: (box?.y ?? 0) + 48 });
  }
  function play(key: string) {
    const node = state.nodes.get(key);
    if (ready && node) onPlay(node);
  }
  const onKeyDown = useFoldersKeys({
    root: scroll,
    rows: ready ? rows : [],
    focus,
    expanded: state.expanded,
    choose,
    toggle: (key, open) => treeMotion.run(key, () => void folders.tree.expand(key, open)),
    play,
    menu,
    all: () => {
      setSelection(selectAll(order));
      folders.selectMany(rows.map((row) => row.node));
    },
  });
  const focusedAt = order.indexOf(focus ?? '');
  const visible = virtual.getVirtualItems();
  return (
    <div
      ref={scroll}
      className={styles.root}
      role="tree"
      aria-label={t('folders.tree')}
      aria-multiselectable
      aria-busy={!ready}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={
        visible.some((row) => row.index === focusedAt) ? `${id}-${focusedAt}` : undefined
      }
    >
      <div ref={layer} className={styles.space} style={{ height: virtual.getTotalSize() }}>
        {visible.map((row) => {
          const entry = rows[row.index];
          if (!entry) return null;
          const { node, level } = entry;
          const expanded = state.expanded.has(node.key);
          const failed = state.failed.has(node.key);
          return (
            <div
              key={node.key}
              id={`${id}-${row.index}`}
              role="treeitem"
              aria-level={level}
              aria-expanded={node.hasChildren ? expanded : undefined}
              aria-selected={selection.selected.has(node.key)}
              className={styles.row}
              data-focused={focus === node.key}
              data-folder-row={node.key}
              title={node.absolutePath}
              style={{
                top: row.start,
                paddingInlineStart: `calc(var(--spacingHorizontalS) + var(--spacingHorizontalXXL) * ${level - 1})`,
              }}
              onClick={(event) => {
                scroll.current?.focus();
                choose(node.key, { ctrl: event.ctrlKey, shift: event.shiftKey }, true, true);
              }}
              onDoubleClick={() => play(node.key)}
              onContextMenu={(event) => {
                event.preventDefault();
                scroll.current?.focus();
                menu(node.key, { x: event.clientX, y: event.clientY });
              }}
            >
              <button
                type="button"
                className={styles.toggle}
                tabIndex={-1}
                aria-label={t(expanded ? 'folders.collapse' : 'folders.expand')}
                disabled={!node.hasChildren || !ready}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  scroll.current?.focus();
                  treeMotion.run(
                    node.key,
                    () => void folders.tree.expand(node.key, failed ? true : !expanded),
                  );
                }}
              >
                {state.pending.has(node.key) ? (
                  <Spinner size="extra-tiny" />
                ) : node.hasChildren ? (
                  <ChevronRight16Regular className={styles.chevron} />
                ) : null}
              </button>
              <Folder20Regular />
              <span className={styles.name}>{node.name}</span>
              <span className={styles.count}>{node.count.toLocaleString()}</span>
              {failed && (
                <Button
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    void folders.tree.expand(node.key, true);
                  }}
                >
                  {t('folders.retry')}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {ready && rows.length === 0 && (
        <p className={styles.empty}>{t(filter.text ? 'folders.noResults' : 'folders.empty')}</p>
      )}
    </div>
  );
}
