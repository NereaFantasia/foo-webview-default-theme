import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  activate,
  emptySelection,
  menuSelection,
  pruneSelection,
  selectAll,
  type Modifiers,
  type KeyedSelection,
} from '../../../kit/keyedSelection.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import type { CommandRegistry } from '../../../nav/commandRegistry.ts';
import { createTypeSearch } from '../../../kit/typeSearch.ts';

export function useArtistList(
  order: readonly string[],
  focus: string | null,
  root: RefObject<HTMLDivElement | null>,
  choose: (name: string) => void,
  play: () => void,
  menu: (names: readonly string[], x: number, y: number) => void,
  commands: CommandRegistry,
  savedSelection: RefObject<KeyedSelection<string>>,
) {
  const [selection, setSelection] = useState(() => savedSelection.current);
  useLayoutEffect(() => {
    savedSelection.current = selection;
  }, [savedSelection, selection]);
  const current = useRef({ order, choose });
  useLayoutEffect(() => {
    current.current = { order, choose };
  });
  useEffect(() => {
    setSelection((old) => pruneSelection(old, order));
  }, [order]);
  const select = (name: string, modifiers: Modifiers) => {
    setSelection((old) => activate(old, order, name, modifiers));
    choose(name);
  };
  const focused = () => document.activeElement === root.current;
  const move = (delta: number, shift = false) => {
    const name = order[Math.max(0, Math.min(order.length - 1, order.indexOf(focus ?? '') + delta))];
    if (name !== undefined) select(name, { ctrl: false, shift });
  };
  const openMenu = (name: string, x: number, y: number) => {
    if (!order.includes(name)) return;
    const next = menuSelection(selection, order, name);
    setSelection(next.selection);
    choose(name);
    menu(next.targets, x, y);
  };
  useCommand({
    id: 'artists.list.next',
    layer: 'widget',
    keys: [{ key: 'ArrowDown' }],
    enabled: focused,
    run: () => move(1),
  });
  useCommand({
    id: 'artists.list.previous',
    layer: 'widget',
    keys: [{ key: 'ArrowUp' }],
    enabled: focused,
    run: () => move(-1),
  });
  useCommand({
    id: 'artists.list.extendNext',
    layer: 'widget',
    keys: [{ key: 'ArrowDown', shift: true }],
    enabled: focused,
    run: () => move(1, true),
  });
  useCommand({
    id: 'artists.list.extendPrevious',
    layer: 'widget',
    keys: [{ key: 'ArrowUp', shift: true }],
    enabled: focused,
    run: () => move(-1, true),
  });
  useCommand({
    id: 'artists.list.first',
    layer: 'widget',
    keys: [{ key: 'Home' }],
    enabled: focused,
    run: () => move(-order.length),
  });
  useCommand({
    id: 'artists.list.last',
    layer: 'widget',
    keys: [{ key: 'End' }],
    enabled: focused,
    run: () => move(order.length),
  });
  useCommand({
    id: 'artists.list.all',
    layer: 'widget',
    keys: [{ key: 'a', ctrl: true }],
    enabled: focused,
    run: () => setSelection(selectAll(order)),
  });
  useCommand({
    id: 'artists.list.play',
    layer: 'widget',
    keys: [{ key: 'Enter' }],
    enabled: focused,
    run: () => {
      if (focus !== null && order.includes(focus)) play();
    },
  });
  useCommand({
    id: 'artists.list.menu',
    layer: 'widget',
    keys: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
    enabled: focused,
    run: () => {
      const box = root.current?.getBoundingClientRect();
      if (box && focus !== null) openMenu(focus, box.x + 24, box.y + 48);
    },
  });
  useEffect(() => {
    const search = createTypeSearch(
      (text) =>
        current.current.order.find(
          (name) => /^[a-z0-9]/i.test(name) && name.toLowerCase().startsWith(text.toLowerCase()),
        ),
      (name) => {
        setSelection(
          activate(emptySelection<string>(), current.current.order, name, {
            ctrl: false,
            shift: false,
          }),
        );
        current.current.choose(name);
      },
    );
    const stops = [...'abcdefghijklmnopqrstuvwxyz0123456789', 'Backspace'].map((key) =>
      commands.register({
        id: `artists.type.${key}`,
        layer: 'widget',
        keys: [{ key }],
        enabled: () => document.activeElement === root.current,
        run: () => {
          search.input(key);
        },
      }),
    );
    return () => {
      stops.forEach((stop) => stop());
      search.dispose();
    };
  }, [commands, root]);
  return { selection, select, openMenu };
}
