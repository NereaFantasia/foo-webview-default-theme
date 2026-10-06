import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import type { Modifiers } from '../kit/keyedSelection.ts';
import type { TypeSearch } from '../kit/typeSearch.ts';
import type { SelectionRanges } from './rangeSelection.ts';
import type { RowSelection } from './rowSelection.ts';
import { createTableInput, type TableInput } from './tableInput.ts';
import type { TableGroupItem, TableItem, TablePoint } from './tableItems.ts';
import type { RowHandlers } from './TrackTableRow.tsx';
import { useGroupAnchor } from './useGroupAnchor.ts';
import type { ScrollFrame } from './useScrollFrame.ts';
import { useTableFocus } from './useTableFocus.ts';
import type { TrackTableRows } from './useTrackTableRows.ts';
import { TablePreviewContext } from './tableContext.ts';

/**
 * 菜单作用于什么：曲目行是那一批选中（右键落在选中之外时只有它自己），分组头是它本身。只带位置不带身份，
 * `rows` 里还有折叠着、不在条目流里的行；调用方要在开菜单这一刻换成曲目，菜单开着时条目流可能已经变了。
 */
export type TableMenuTarget =
  | { readonly kind: 'rows'; readonly index: number; readonly rows: SelectionRanges }
  | { readonly kind: 'group'; readonly index: number };

/** 单击分组头时的修饰键：比行多一个 Alt，节头上 Alt 单击是连同里面的分组一起开合。 */
export interface GroupModifiers extends Modifiers {
  readonly alt: boolean;
}

/** 表格交给调用方的动作；下标都是显示位（条目流的下标）。 */
export interface TableCallbacks<G> {
  /** 双击或回车起播。曲目行与分组头都会来，按条目的种类定播什么。 */
  readonly onPlay: (index: number) => void;
  readonly onMenu?: (target: TableMenuTarget, point: TablePoint) => void;
  /** 单击分组头：焦点已经落上去；需要开合时调 toggle，保留滚动位置。按钮、链接上的点击不算。 */
  readonly onGroupClick?: (index: number, modifiers: GroupModifiers, toggle: () => void) => void;
  readonly onToggleGroup?: (index: number) => void;
  readonly onSetGroup?: (index: number, collapsed: boolean) => void;
  readonly onExpandSiblings?: (index: number) => void;
  /** 打字即跳给一条打分，见 `findTablePrefix`；不给就不接打字即跳。 */
  readonly rank?: (item: TableItem<G>, needle: string) => number | undefined;
  /**
   * 调用方自己做的打字即跳，给行分页取、要异步翻页才找得到的表用：键的分派与表格自己的一样（串里有字时
   * 可打印字符先给它，处理了表格键就清串），找到后由它经句柄的 `reveal` 落焦点。给了 `rank` 时不看它。
   */
  readonly typeSearch?: TypeSearch;
}

/** 分组头上的指针动作，由表格包在调用方画的分组头外面。 */
export interface GroupHandlers {
  click(index: number, event: MouseEvent): void;
  play(index: number): void;
  menu(index: number, point: TablePoint): void;
  /** 调用方画的开合键调它：开合前后这个分组头在视口里的位置不变。 */
  toggle(index: number): void;
}

export interface TrackTableInputOptions<G> extends TableCallbacks<G>, ScrollFrame {
  readonly items: readonly TableItem<G>[];
  readonly selection: RowSelection;
  readonly rowHeight: number;
  readonly groupHeight: (item: TableGroupItem<G>) => number;
  readonly groupFocus: boolean;
  readonly rows: TrackTableRows;
  /** 行跟着滚的元素：表格自己的滚动区，或调用方给的页面滚动元素。 */
  readonly scroller: RefObject<HTMLElement | null>;
  /** 显示位上那一条的元素 id。 */
  readonly rowId: (index: number) => string;
  readonly rate: RowHandlers['rate'];
}

export interface TrackTableInput {
  /** 焦点所在的显示位；没有焦点、或那一条已不在条目流里时为 -1。 */
  readonly focus: number;
  /** 焦点落到这个键的条目上，不改选中、不滚动；给调用方的句柄用。 */
  readonly setFocusKey: (key: string | null) => void;
  /** 见 `TrackTableHandle.reveal`。 */
  readonly reveal: (index: number, select: boolean) => boolean;
  readonly rowHandlers: RowHandlers;
  readonly groupHandlers: GroupHandlers;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
}

const PLAIN: Modifiers = { ctrl: false, shift: false };

const modifiersOf = (event: MouseEvent): Modifiers => ({
  ctrl: event.ctrlKey || event.metaKey,
  shift: event.shiftKey,
});

/**
 * 表格的指针与键盘：落焦点、改选中、起播、开菜单、分组开合与打字即跳。焦点按条目的键记，条目流重排、
 * 折叠之后仍跟着同一条。键只在表格根元素自己拿着焦点时处理，列头与调用方画在分组头里的控件自己管自己的键。
 * 分组开合都经 `useGroupAnchor`，开合前后那个分组头在视口里不挪位置。
 */
export function useTrackTableInput<G>(options: TrackTableInputOptions<G>): TrackTableInput {
  const preview = useContext(TablePreviewContext);
  const { focus, setFocusKey } = useTableFocus(options.items);
  const latest = useRef({ options, focus, preview });
  useLayoutEffect(() => {
    latest.current = { options, focus, preview };
  });
  const anchored = useGroupAnchor(options);

  const [actions] = useState(() => {
    const view = () => latest.current.options;
    const land = (index: number, modifiers: Modifiers | null, preview = false) => {
      const item = view().items[index];
      if (!item || item.kind === 'filler') return undefined;
      setFocusKey(item.key);
      if (item.kind === 'row' && modifiers) view().selection.activate(item.order, modifiers);
      if (preview && item.kind === 'row' && item.track) latest.current.preview?.(item.track);
      return item;
    };
    const reveal = (index: number, select: boolean) => {
      if (!land(index, select ? PLAIN : null, select)) return false;
      view().rows.virtualizer.scrollToIndex(index, { align: 'center' });
      return true;
    };
    const openMenu = (index: number, point: TablePoint) => {
      const { onMenu, selection } = view();
      const item = onMenu ? land(index, null, true) : undefined;
      if (!onMenu || !item) return;
      if (item.kind === 'row')
        onMenu({ kind: 'rows', index, rows: selection.menuAt(item.order) }, point);
      else onMenu({ kind: 'group', index }, point);
    };
    // 键盘开菜单：落点是那一条的左下角。那一条不在视口里时先滚回来、等一帧再量：滚出去的要么已经不在 DOM
    // 里，要么还在视口上下多画的那几条里、只是被裁掉了，量出来的落点在表格外面。吸顶列头与下内边距那两截
    // 不算视口。
    const shownBox = (index: number) => {
      const box = document.getElementById(view().rowId(index))?.getBoundingClientRect();
      const area = view().scroller.current?.getBoundingClientRect();
      if (!box || !area) return undefined;
      const top = area.top + view().stickyTop;
      return box.top >= top && box.bottom <= area.bottom - view().bottomInset ? box : undefined;
    };
    const menuAtIndex = async (index: number) => {
      const key = view().items[index]?.key;
      let box = shownBox(index);
      if (!box) {
        view().rows.virtualizer.scrollToIndex(index, { align: 'auto' });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        box = shownBox(index);
      }
      if (box && view().items[index]?.key === key) openMenu(index, { x: box.left, y: box.bottom });
    };
    const rowHandlers: RowHandlers = {
      click(index, event) {
        // 双击的第二下不再改选中：Ctrl 双击不会把刚切换的那一行又切回去。
        if (event.detail < 2) land(index, modifiersOf(event), true);
      },
      play: (index) => view().onPlay(index),
      menu: openMenu,
      rate: (track, value) => view().rate(track, value),
    };
    const groupHandlers: GroupHandlers = {
      click(index, event) {
        if (event.detail >= 2 || !land(index, null)) return;
        view().onGroupClick?.(index, { ...modifiersOf(event), alt: event.altKey }, () =>
          anchored(index, view().onToggleGroup),
        );
      },
      play: (index) => view().onPlay(index),
      menu: openMenu,
      toggle: (index) => {
        if (land(index, null)) anchored(index, view().onToggleGroup);
      },
    };
    const sink = {
      land(index: number, modifiers: Modifiers) {
        if (land(index, modifiers, true))
          view().rows.virtualizer.scrollToIndex(index, { align: 'auto' });
      },
      play: (index: number) => view().onPlay(index),
      toggleGroup: groupHandlers.toggle,
      setGroup(index: number, collapsed: boolean) {
        const set = view().onSetGroup;
        anchored(index, set && ((at) => set(at, collapsed)));
      },
      expandSiblings: (index: number) => anchored(index, view().onExpandSiblings),
      selectAll: () => view().selection.selectAll(),
      menu: (index: number) => void menuAtIndex(index),
    };
    return { reveal, rowHandlers, groupHandlers, sink };
  });

  // 输入模型带着打字即跳的定时器，建在 effect 里才释放得掉。给不给 `rank` 决定表格自己建不建打字即跳，变了
  // 就重建；调用方给的那一个每次按键时现取，换了不用重建。
  const [input, setInput] = useState<TableInput | null>(null);
  const typing = options.rank !== undefined;
  useEffect(() => {
    const view = () => latest.current.options;
    const created = createTableInput(
      {
        entries: () => ({ count: view().items.length, itemAt: (index) => view().items[index] }),
        focus: () => latest.current.focus,
        pageSize: () => Math.floor(view().rows.shownHeight / view().rowHeight),
        groupFocus: () => view().groupFocus,
        rank: typing
          ? (index, needle) => {
              const item = view().items[index];
              return item ? view().rank?.(item, needle) : undefined;
            }
          : undefined,
        typeSearch: () => view().typeSearch,
      },
      actions.sink,
    );
    setInput(created);
    return () => created.dispose();
  }, [actions, typing]);

  return {
    focus,
    setFocusKey,
    reveal: actions.reveal,
    rowHandlers: actions.rowHandlers,
    groupHandlers: actions.groupHandlers,
    onKeyDown(event) {
      if (event.target === event.currentTarget && !event.nativeEvent.isComposing) {
        input?.keydown(event);
      }
    },
    onKeyUp(event) {
      if (event.target === event.currentTarget) input?.keyup(event);
    },
  };
}
