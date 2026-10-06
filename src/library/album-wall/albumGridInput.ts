import type { GridItem } from './albumGridLayout.ts';
import type { MenuPoint } from '../albumMenu.ts';
import { albumAt, findGridPrefix, resolveGridKey, type GridPosition } from './albumGridKeys.ts';
import type { Album } from '../../host/libraryContract.ts';
import type { Modifiers } from '../../kit/keyedSelection.ts';
import { createTypeSearch, type TypeSearch } from '../../kit/typeSearch.ts';

const PLAIN: Modifiers = { ctrl: false, shift: false };

/** 网格此刻的样子，由组件给。 */
export interface GridInputSource {
  items(): readonly GridItem[];
  /** 焦点所在的那一块；没有焦点时为 undefined。 */
  position(): GridPosition | undefined;
  /** 一屏放得下几行图块，翻页按它跳。 */
  pageRows(): number;
  /** 键盘开菜单的落点：焦点图块的左下角，由组件量 DOM 给。 */
  menuAnchor(): MenuPoint;
}

/** 输入的去向，由组件接到选择、菜单、下拉与滚动上。 */
export interface GridInputSink {
  /**
   * 焦点落到某一块上。给了 `modifiers` 就按它改选中（没按修饰键也要给，那是「只选它」）；
   * 右键只移焦点、不改选中，不给。`at` 是落点那一块，同一张专辑在几节里各有一块时焦点跟着它走。
   */
  focus(album: Album, at?: GridPosition, modifiers?: Modifiers): void;
  selectAll(): void;
  play(album: Album): void;
  /** Shift + 滚轮：上滚一格 +1、下滚 -1，换成多少像素由上层定。 */
  zoom(notches: number): void;
  scrollTo(index: number): void;
  contextMenu(album: Album, point: MenuPoint): void;
  /** 空格：展开或收起焦点那张的下拉；`sectionKey` 是焦点所在的节。 */
  toggle(album: Album, sectionKey: string | null): void;
}

export type GridKeyEvent = Pick<KeyboardEvent, 'key' | 'preventDefault'> &
  Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>>;

export interface AlbumGridInput {
  readonly typeSearch: TypeSearch;
  /** 在网格元素上的 keydown。 */
  keydown(event: GridKeyEvent): void;
  /** 在网格元素上的 keyup：Menu 键在松开时开菜单。 */
  keyup(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>): void;
  wheel(event: Pick<WheelEvent, 'shiftKey' | 'deltaY' | 'preventDefault'>): void;
  /** 右键：先落焦点再开菜单。 */
  contextMenu(album: Album, point: MenuPoint): void;
  dispose(): void;
}

/**
 * 封面墙的键盘与滚轮：回车播放、空格开合下拉、移动键移焦点并滚进视口、Ctrl+A 全选、Shift+F10 与
 * Menu 键开菜单，可打印字符先给打字即跳。移动键带 Shift 扩成区间、带 Ctrl 切换落点那一块。
 * Esc 不在这里：列表部件不认领 Esc，它只关浮层。带 Alt 的键一律不接、不拦缺省，交给命令登记处：
 * Alt+← / → 是后退与前进。
 */
export function createAlbumGridInput(source: GridInputSource, sink: GridInputSink): AlbumGridInput {
  // 焦点落在命中的那一块（节头命中是它下面第一块），滚动目标仍是命中的条目，节头因此一并露出来。
  const typeSearch = createTypeSearch(
    (text) => findGridPrefix(source.items(), source.position(), text),
    (hit) => {
      sink.focus(hit.album, hit.at, PLAIN);
      sink.scrollTo(hit.index);
    },
  );

  function contextMenu(album: Album, point: MenuPoint): void {
    sink.focus(album);
    sink.contextMenu(album, point);
  }

  function openMenuAtFocus(): void {
    const album = albumAt(source.items(), source.position());
    if (album) contextMenu(album, source.menuAnchor());
  }

  return {
    typeSearch,
    keydown(event) {
      if (event.altKey === true) return;
      if (event.key === 'F10' && event.shiftKey) {
        event.preventDefault();
        openMenuAtFocus();
        return;
      }
      const ctrl = event.ctrlKey === true || event.metaKey === true;
      if (ctrl && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        sink.selectAll();
        return;
      }
      const plain = !ctrl;
      if (plain && typeSearch.input(event.key)) {
        event.preventDefault();
        return;
      }
      // 打字即跳的串空着才轮到这里，串里的空格照样归它。
      const items = source.items();
      const position = source.position();
      if (plain && event.key === ' ') {
        const item = position ? items[position.index] : undefined;
        const album = albumAt(items, position);
        if (!album || item?.kind !== 'row') return;
        event.preventDefault();
        sink.toggle(album, item.sectionKey);
        return;
      }
      const action = resolveGridKey(items, position, event.key, source.pageRows());
      if (action.kind === 'none') return;
      event.preventDefault();
      typeSearch.clear();
      if (action.kind === 'play') sink.play(action.album);
      if (action.kind !== 'move') return;
      sink.focus(action.album, action.next, { ctrl, shift: event.shiftKey === true });
      sink.scrollTo(action.next.index);
    },
    keyup(event) {
      // Chromium 在 Menu 键松开时才合成 contextmenu，也只看这一下拦没拦缺省；不拦，浏览器自己的菜单
      // 会对着焦点元素叠上来。
      if (event.key !== 'ContextMenu') return;
      event.preventDefault();
      openMenuAtFocus();
    },
    wheel(event) {
      if (!event.shiftKey || event.deltaY === 0) return;
      event.preventDefault();
      sink.zoom(event.deltaY < 0 ? 1 : -1);
    },
    contextMenu,
    dispose() {
      typeSearch.dispose();
    },
  };
}
