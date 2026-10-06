import type { Modifiers } from '../kit/keyedSelection.ts';
import { createTypeSearch, type TypeSearch } from '../kit/typeSearch.ts';
import {
  findTablePrefix,
  resolveTableKey,
  type KeyEntries,
  type TableKeyInput,
} from './tableKeys.ts';

const PLAIN: Modifiers = { ctrl: false, shift: false };

/** 表格此刻的样子，由组件给。 */
export interface TableInputSource {
  entries(): KeyEntries;
  /** 焦点所在的显示位；没有焦点时为 -1。 */
  focus(): number;
  /** 一屏放得下几个条目。 */
  pageSize(): number;
  groupFocus(): boolean;
  /** 打字即跳给每一条打分，见 `findTablePrefix`；给了就由表格自己建打字即跳。 */
  readonly rank?: (index: number, needle: string) => number | undefined;
  /** 调用方自己做的打字即跳，每次按键时现取；给了 `rank` 时不看它。两样都没有就不接打字即跳。 */
  readonly typeSearch?: () => TypeSearch | undefined;
}

/** 输入的去向，由组件接到焦点、选中、开合、播放与菜单上。 */
export interface TableInputSink {
  /** 焦点落到这一位并滚进视口；是曲目行就按修饰键改选中。 */
  land(index: number, modifiers: Modifiers): void;
  play(index: number): void;
  toggleGroup(index: number): void;
  setGroup(index: number, collapsed: boolean): void;
  expandSiblings(index: number): void;
  selectAll(): void;
  /** 开这一条的菜单；落点由组件按那一行量 DOM 定。 */
  menu(index: number): void;
}

export type TableKeyEvent = TableKeyInput & Pick<KeyboardEvent, 'preventDefault'>;

export interface TableInput {
  /** 此刻接打字即跳的那一个：表格自己建的，或调用方给的；都没有时为 null。 */
  readonly typeSearch: TypeSearch | null;
  keydown(event: TableKeyEvent): void;
  /** Menu 键在松开时开菜单。 */
  keyup(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>): void;
  dispose(): void;
}

/**
 * 表格的键盘：按 `resolveTableKey` 分派，表格不要的可打印字符给打字即跳；打字即跳的串里已经有字时，可打印
 * 字符先给它。处理过的键拦下缺省，命令登记处就不再接手，没处理的（Alt+← 这类）照常往上走。Esc 不在这里：
 * 列表部件不认领 Esc，它只关浮层。
 */
export function createTableInput(source: TableInputSource, sink: TableInputSink): TableInput {
  const rank = source.rank;
  // 命中的那一条按单击处理：焦点落上去，是曲目行就只选它。
  const owned = rank
    ? createTypeSearch(
        (text) => findTablePrefix(source.entries(), source.focus(), text, rank),
        (index) => sink.land(index, PLAIN),
      )
    : null;
  const current = () => owned ?? source.typeSearch?.() ?? null;

  function menuAtFocus(): void {
    const focus = source.focus();
    const kind = focus >= 0 ? source.entries().itemAt(focus)?.kind : undefined;
    if (kind === 'row' || kind === 'group') sink.menu(focus);
  }

  return {
    get typeSearch() {
      return current();
    },
    keydown(event) {
      const typeSearch = current();
      const plain = event.ctrlKey !== true && event.metaKey !== true && event.altKey !== true;
      const typing = () => plain && typeSearch !== null && typeSearch.input(event.key);
      // 串里已经有字时可打印字符都接着打，空格与 `*` 也不例外；串空着时先问表格键，表格不要的才开一个新串。
      const busy = (typeSearch?.state.text ?? '') !== '';
      if (busy && typing()) {
        event.preventDefault();
        return;
      }
      const entries = source.entries();
      const action = resolveTableKey(
        {
          count: entries.count,
          itemAt: (index) => entries.itemAt(index),
          focus: source.focus(),
          pageSize: Math.max(1, source.pageSize()),
          groupFocus: source.groupFocus(),
        },
        event,
      );
      if (action.kind === 'none') {
        if (!busy && typing()) event.preventDefault();
        return;
      }
      event.preventDefault();
      typeSearch?.clear();
      switch (action.kind) {
        case 'land':
          sink.land(action.index, action.modifiers);
          break;
        case 'play':
          sink.play(action.index);
          break;
        case 'toggleGroup':
          sink.toggleGroup(action.index);
          break;
        case 'setGroup':
          sink.setGroup(action.index, action.collapsed);
          break;
        case 'expandSiblings':
          sink.expandSiblings(action.index);
          break;
        case 'selectAll':
          sink.selectAll();
          break;
        case 'menu':
          sink.menu(action.index);
          break;
        case 'block':
          break;
      }
    },
    keyup(event) {
      // Chromium 在 Menu 键松开时才合成 contextmenu，也只看这一下拦没拦缺省；不拦，浏览器自己的菜单
      // 会对着焦点元素叠上来。
      if (event.key !== 'ContextMenu') return;
      event.preventDefault();
      menuAtFocus();
    },
    dispose() {
      // 调用方给的那一个归调用方释放。
      owned?.dispose();
    },
  };
}
