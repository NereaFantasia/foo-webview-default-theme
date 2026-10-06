import type { PlaylistInfo } from 'foo-webview-sdk';
import type { RefObject } from 'react';
import type { KeyChord } from '../../nav/commandRegistry.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { stepSlot } from './playlistReorder.ts';
import type { PlaylistDraft, PlaylistRename } from './SidebarPlaylists.tsx';
import type { PlaylistReorder } from './usePlaylistReorder.ts';

/** 焦点在播放列表节的某一行时改名。设置页的快捷键一览也取这几份。 */
export const RENAME_KEYS: readonly KeyChord[] = [{ key: 'F2' }];
/** 把焦点那一行上移、下移一位。 */
export const MOVE_UP_KEYS: readonly KeyChord[] = [{ key: 'ArrowUp', alt: true }];
export const MOVE_DOWN_KEYS: readonly KeyChord[] = [{ key: 'ArrowDown', alt: true }];

export interface PlaylistKeysOptions {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly reorder: PlaylistReorder;
  readonly rename: PlaylistRename;
  readonly draft: PlaylistDraft;
  /** 此刻的完整清单，按序号排。 */
  readonly items: readonly PlaylistInfo[];
  /** 此刻能不能调整顺序：过滤中、改名中不行。 */
  readonly canReorder: boolean;
  move(guid: string, slot: number): void;
  closeFilter(): void;
}

/** 焦点在播放列表节里的哪个元素；不在这一节里答 null。 */
function focusedIn(scroller: RefObject<HTMLElement | null>): HTMLElement | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !scroller.current?.contains(element)) return null;
  return element;
}

/** 焦点所在那一行的列表 GUID。 */
function focusedEntry(scroller: RefObject<HTMLElement | null>): string | null {
  return focusedIn(scroller)?.getAttribute('data-playlist-entry') ?? null;
}

/** 焦点所在的名字输入框：改名的带 `data-rename-input`（值是 GUID），新建的带 `data-new-playlist-input`。 */
function focusedNameInput(scroller: RefObject<HTMLElement | null>): HTMLInputElement | null {
  const element = focusedIn(scroller);
  if (!(element instanceof HTMLInputElement)) return null;
  const named =
    element.hasAttribute('data-rename-input') || element.hasAttribute('data-new-playlist-input');
  return named ? element : null;
}

/**
 * 播放列表节的按键，都登记在命令登记处：焦点在某一行时 F2 改名（拖动中不接）、Alt+↑ / Alt+↓ 调整顺序；
 * 改名与新建的名字框里回车提交、Esc 取消；筛选框里 Esc 收起；拖动中 Esc 取消拖动。
 * 右键菜单的 Menu 键与 Shift+F10 不在这里：浏览器把它们合成成 `contextmenu`，由那一行自己接。
 */
export function usePlaylistKeys(options: PlaylistKeysOptions): void {
  const { scroller, reorder, rename, draft, items, canReorder, move, closeFilter } = options;

  useCommand({
    id: 'playlists.rename',
    layer: 'widget',
    keys: RENAME_KEYS,
    // 拖动中不进改名：改名框顶掉被拖的那一行，按行算的插入位就错了。
    enabled: () => reorder.drag === null && focusedEntry(scroller) !== null,
    run: () => {
      const guid = focusedEntry(scroller);
      if (guid !== null) rename.start(guid);
    },
  });
  const moveBy = (delta: -1 | 1) => ({
    layer: 'widget' as const,
    keys: delta < 0 ? MOVE_UP_KEYS : MOVE_DOWN_KEYS,
    enabled: () => canReorder && focusedEntry(scroller) !== null,
    run: () => {
      const guid = focusedEntry(scroller);
      const from = items.findIndex((item) => item.guid === guid);
      const slot = from < 0 ? null : stepSlot(from, delta, items.length);
      if (guid !== null && slot !== null) move(guid, slot);
    },
  });
  useCommand({ id: 'playlists.moveUp', ...moveBy(-1) });
  useCommand({ id: 'playlists.moveDown', ...moveBy(1) });
  const finishName = (result: 'commit' | 'cancel') => () => {
    const input = focusedNameInput(scroller);
    if (!input) return;
    const guid = input.getAttribute('data-rename-input');
    if (guid) rename.finish(guid, result, input.value, true);
    else draft.finish(result, input.value, true);
  };
  useCommand({
    id: 'playlists.renameCommit',
    layer: 'input',
    keys: [{ key: 'Enter' }],
    enabled: () => focusedNameInput(scroller) !== null,
    run: finishName('commit'),
  });
  useCommand({
    id: 'playlists.renameCancel',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => focusedNameInput(scroller) !== null,
    run: finishName('cancel'),
  });
  useCommand({
    id: 'playlists.closeFilter',
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () => focusedIn(scroller)?.hasAttribute('data-playlist-filter') ?? false,
    run: closeFilter,
  });
  useCommand({
    id: 'playlists.cancelDrag',
    layer: 'gesture',
    keys: [{ key: 'Escape' }],
    enabled: () => reorder.drag !== null,
    run: reorder.cancel,
  });
}
