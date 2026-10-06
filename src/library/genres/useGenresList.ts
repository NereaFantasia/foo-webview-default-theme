import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import {
  activate,
  menuSelection,
  pruneSelection,
  selectAll,
  type Modifiers,
  type KeyedSelection,
} from '../../kit/keyedSelection.ts';
import { useCommand } from '../../nav/useCommand.ts';
import type { GenreEntry } from './genresModel.ts';

export function useGenresList(
  entries: readonly GenreEntry[],
  focus: string | null,
  root: RefObject<HTMLDivElement | null>,
  setFocus: (key: string | null) => void,
  choose: (key: string) => void,
  open: (key: string) => void,
  menu: (keys: readonly string[], x: number, y: number) => void,
  menuOpen: boolean,
  savedSelection: RefObject<KeyedSelection<string>>,
) {
  const [selection, setSelection] = useState(() => savedSelection.current);
  useLayoutEffect(() => {
    savedSelection.current = selection;
  }, [savedSelection, selection]);
  const order = entries.map((entry) => entry.key);
  useEffect(() => {
    setSelection((old) =>
      pruneSelection(
        old,
        entries.map((entry) => entry.key),
      ),
    );
  }, [entries]);
  const select = (key: string, modifiers: Modifiers) => {
    setSelection((old) => activate(old, order, key, modifiers));
    setFocus(key);
    choose(key);
  };
  const openMenu = (key: string, x: number, y: number) => {
    const next = menuSelection(selection, order, key);
    setSelection(next.selection);
    setFocus(key);
    menu(next.targets, x, y);
  };
  const focused = () => !menuOpen && root.current === document.activeElement;
  const move = (delta: number, shift = false) => {
    const at = order.indexOf(focus ?? '');
    const key = order[Math.max(0, Math.min(order.length - 1, at + delta))];
    if (key !== undefined) select(key, { ctrl: false, shift });
  };
  useCommand({
    id: 'genres.list.next',
    layer: 'widget',
    keys: [{ key: 'ArrowDown' }],
    enabled: focused,
    run: () => move(1),
  });
  useCommand({
    id: 'genres.list.previous',
    layer: 'widget',
    keys: [{ key: 'ArrowUp' }],
    enabled: focused,
    run: () => move(-1),
  });
  useCommand({
    id: 'genres.list.extendNext',
    layer: 'widget',
    keys: [{ key: 'ArrowDown', shift: true }],
    enabled: focused,
    run: () => move(1, true),
  });
  useCommand({
    id: 'genres.list.extendPrevious',
    layer: 'widget',
    keys: [{ key: 'ArrowUp', shift: true }],
    enabled: focused,
    run: () => move(-1, true),
  });
  useCommand({
    id: 'genres.list.first',
    layer: 'widget',
    keys: [{ key: 'Home' }],
    enabled: focused,
    run: () => move(-order.length),
  });
  useCommand({
    id: 'genres.list.last',
    layer: 'widget',
    keys: [{ key: 'End' }],
    enabled: focused,
    run: () => move(order.length),
  });
  useCommand({
    id: 'genres.list.all',
    layer: 'widget',
    keys: [{ key: 'a', ctrl: true }],
    enabled: focused,
    run: () => setSelection(selectAll(order)),
  });
  useCommand({
    id: 'genres.list.enter',
    layer: 'widget',
    keys: [{ key: 'Enter' }],
    enabled: focused,
    run: () => {
      if (focus !== null && order.includes(focus)) open(focus);
    },
  });
  useCommand({
    id: 'genres.list.menu',
    layer: 'widget',
    keys: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
    enabled: focused,
    run: () => {
      const rect = root.current?.getBoundingClientRect();
      if (focus !== null && order.includes(focus) && rect)
        openMenu(focus, rect.x + 24, rect.y + 48);
    },
  });
  return { selection, focus, select, openMenu };
}
