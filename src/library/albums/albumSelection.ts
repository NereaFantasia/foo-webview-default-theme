import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { sectionsSettledAtom, visibleAlbumsAtom } from './albumBrowse.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../../host/libraryContract.ts';
import {
  activate,
  emptySelection,
  menuSelection,
  pruneSelection,
  selectAll,
  type KeyedSelection,
  type Modifiers,
} from '../../kit/keyedSelection.ts';

const selectionAtom = atom<KeyedSelection<AlbumKey>>(emptySelection<AlbumKey>());

/**
 * 封面墙上选中的专辑键。过滤、折叠、库变更后看不见的自动去掉，换分节与排序保留。分节还没排定时
 * （首次读取中、艺术家档等署名表、一级目录档等库根）不剔：那时看得见的专辑是临时的空清单。
 */
export const albumSelectionAtom: Atom<ReadonlySet<AlbumKey>> = atom(
  (get) => get(selectionAtom).selected,
);

export interface AlbumSelectionService {
  /**
   * 单击或键盘落到一张封面上，按修饰键改选中。`at` 是它在阅读顺序里的位置（`readingPositionOf`），
   * 同一张专辑在几节里各有一块时用它认出点的是哪一块。
   */
  activate(album: Album, modifiers: Modifiers, at?: number): void;
  /** 选中全部看得见的专辑；分节还没排定时不动。 */
  selectAll(): void;
  clear(): void;
  /**
   * 右键或「更多」落在这张封面上时菜单作用于哪几张：它在选择里就是整个选择（阅读顺序），不在就先
   * 改为只选它、只作用于它。它此刻不在看得见的专辑里时只作用于它，选中不动。
   */
  menuTargets(album: Album, at?: number): Album[];
  /** 拖动这张封面时带上哪几张：与 `menuTargets` 同一口径，但不改选中。 */
  targetsOf(album: Album, at?: number): Album[];
  dispose(): void;
}

/** 启动封面墙的多选。选中不进历史，回到这一页时也不恢复。 */
export function startAlbumSelection(store: Store): AlbumSelectionService {
  store.set(selectionAtom, emptySelection<AlbumKey>());
  const orderOf = () => store.get(visibleAlbumsAtom).map(albumKeyOf);
  const settled = () => store.get(sectionsSettledAtom);
  const change = (next: KeyedSelection<AlbumKey>) => {
    if (next !== store.get(selectionAtom)) store.set(selectionAtom, next);
  };
  // 键换回专辑行；点中的那张可能已不在看得见的专辑里，用传进来的那一行。
  const albumsOf = (keys: readonly AlbumKey[], picked: Album): Album[] => {
    const byKey = new Map(store.get(visibleAlbumsAtom).map((row) => [albumKeyOf(row), row]));
    byKey.set(albumKeyOf(picked), picked);
    return keys.flatMap((key) => byKey.get(key) ?? []);
  };
  const offVisible = store.sub(visibleAlbumsAtom, () => {
    if (settled()) change(pruneSelection(store.get(selectionAtom), orderOf()));
  });

  return {
    activate(album, modifiers, at) {
      change(activate(store.get(selectionAtom), orderOf(), albumKeyOf(album), modifiers, at));
    },
    selectAll() {
      if (settled()) change(selectAll(orderOf()));
    },
    clear() {
      change(emptySelection<AlbumKey>());
    },
    menuTargets(album, at) {
      const next = menuSelection(store.get(selectionAtom), orderOf(), albumKeyOf(album), at);
      change(next.selection);
      return albumsOf(next.targets, album);
    },
    targetsOf(album, at) {
      return albumsOf(
        menuSelection(store.get(selectionAtom), orderOf(), albumKeyOf(album), at).targets,
        album,
      );
    },
    dispose() {
      offVisible();
    },
  };
}
