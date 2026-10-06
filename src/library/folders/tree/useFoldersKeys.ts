import { useEffect, useId, useRef, type RefObject, type KeyboardEvent } from 'react';
import { createTypeSearch, type TypeSearch } from '../../../kit/typeSearch.ts';
import type { Modifiers } from '../../../kit/keyedSelection.ts';
import type { FolderRow } from './foldersModel.ts';
import { useService } from '../../../kit/useService.ts';
import { commandsKey } from '../../../nav/commandRegistry.ts';

export interface FoldersKeysOptions {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly rows: readonly FolderRow[];
  readonly focus: string | null;
  readonly expanded: ReadonlySet<string>;
  choose(key: string, modifiers: Modifiers, preview?: boolean): void;
  toggle(key: string, open?: boolean): void;
  play(key: string): void;
  menu(key: string): void;
  all(): void;
}
export function useFoldersKeys(options: FoldersKeysOptions) {
  const id = useId();
  const commands = useService(commandsKey);
  const latest = useRef(options);
  const searchRef = useRef<TypeSearch | null>(null);
  latest.current = options;
  useEffect(() => {
    const enabled = () => latest.current.root.current === document.activeElement;
    const search = createTypeSearch(
      (text) =>
        latest.current.rows.find(({ node }) =>
          node.name.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()),
        )?.node.key,
      (key) => latest.current.choose(key, { ctrl: false, shift: false }, false),
    );
    searchRef.current = search;
    const offs: (() => void)[] = [];
    const moves = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
    for (const key of [
      ...moves,
      'ArrowLeft',
      'ArrowRight',
      ' ',
      'Enter',
      'ContextMenu',
      'F10',
      'a',
    ]) {
      for (const ctrl of [false, true])
        for (const shift of [false, true]) {
          if (key === 'a' && (!ctrl || shift)) continue;
          if (key === 'F10' && (ctrl || !shift)) continue;
          if (!moves.includes(key) && key !== 'a' && key !== 'F10' && (ctrl || shift)) continue;
          offs.push(
            commands.register({
              id: `folders.tree.${id}.${key}.${ctrl}.${shift}`,
              layer: 'widget',
              keys: [{ key, ctrl, shift }],
              enabled,
              run() {
                const o = latest.current;
                const at = Math.max(
                  0,
                  o.rows.findIndex(({ node }) => node.key === o.focus),
                );
                const row = o.rows[at];
                if (!row) return;
                const { node } = row;
                if (key === 'a') {
                  o.all();
                  return;
                }
                if (key === 'Enter') {
                  o.play(node.key);
                  return;
                }
                if (key === 'ContextMenu' || key === 'F10') {
                  o.menu(node.key);
                  return;
                }
                if (key === ' ') {
                  o.toggle(node.key);
                  return;
                }
                if (key === 'ArrowRight') {
                  if (!o.expanded.has(node.key)) o.toggle(node.key, true);
                  else if (o.rows[at + 1]?.node.parent === node.key)
                    o.choose(o.rows[at + 1]!.node.key, { ctrl, shift });
                  return;
                }
                if (key === 'ArrowLeft') {
                  if (o.expanded.has(node.key)) o.toggle(node.key, false);
                  else if (node.parent) o.choose(node.parent, { ctrl, shift });
                  return;
                }
                const page = Math.max(1, Math.floor((o.root.current?.clientHeight ?? 320) / 32));
                const next =
                  key === 'Home'
                    ? 0
                    : key === 'End'
                      ? o.rows.length - 1
                      : at +
                        (key === 'ArrowUp'
                          ? -1
                          : key === 'PageUp'
                            ? -page
                            : key === 'PageDown'
                              ? page
                              : 1);
                const target = o.rows[Math.max(0, Math.min(next, o.rows.length - 1))];
                if (target) o.choose(target.node.key, { ctrl, shift });
              },
            }),
          );
        }
    }
    return () => {
      offs.forEach((off) => off());
      search.dispose();
      searchRef.current = null;
    };
  }, [commands, id]);
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      event.key === ' '
    )
      return;
    if (searchRef.current?.input(event.key)) event.preventDefault();
  };
}
