import { describe, expect, it, vi } from 'vitest';
import { createTypeSearch, type TypeSearch } from '../../../src/kit/typeSearch.ts';
import {
  createTableInput,
  type TableInputSink,
  type TableKeyEvent,
} from '../../../src/table/tableInput.ts';
import type { KeyEntry } from '../../../src/table/tableKeys.ts';

const ROW: KeyEntry = { kind: 'row' };
const STREAM: KeyEntry[] = [{ kind: 'group', level: 0, collapsed: false }, ROW, ROW, ROW];
const NAMES = ['Side A', 'Alpha', 'Beta', 'Gamma'];

function setup(options: { focus?: number; typing?: boolean; external?: TypeSearch } = {}) {
  let focus = options.focus ?? -1;
  const sink: TableInputSink = {
    land: vi.fn((index: number) => {
      focus = index;
    }),
    play: vi.fn(),
    toggleGroup: vi.fn(),
    setGroup: vi.fn(),
    expandSiblings: vi.fn(),
    selectAll: vi.fn(),
    menu: vi.fn(),
  };
  const input = createTableInput(
    {
      entries: () => ({ count: STREAM.length, itemAt: (index) => STREAM[index] }),
      focus: () => focus,
      pageSize: () => 10,
      groupFocus: () => true,
      typeSearch: () => options.external,
      ...(options.typing === false
        ? {}
        : {
            rank: (index: number, needle: string) =>
              NAMES[index]?.toLocaleLowerCase().startsWith(needle) ? 0 : undefined,
          }),
    },
    sink,
  );
  const press = (key: string, modifiers: Omit<Partial<TableKeyEvent>, 'preventDefault'> = {}) => {
    const preventDefault = vi.fn();
    input.keydown({ key, preventDefault, ...modifiers });
    return preventDefault.mock.calls.length > 0;
  };
  return { input, sink, press };
}

describe('表格键盘', () => {
  it('可打印字符先给打字即跳，命中按单击落焦点', () => {
    const { sink, press, input } = setup({ focus: 1 });
    expect(press('g')).toBe(true);
    expect(sink.land).toHaveBeenLastCalledWith(3, { ctrl: false, shift: false });
    expect(input.typeSearch?.state.text).toBe('g');
    input.dispose();
  });

  it('串不空时空格也归打字即跳，串空时空格按表格键处理', () => {
    const { sink, press, input } = setup({ focus: 2 });
    press(' ');
    expect(sink.land).toHaveBeenLastCalledWith(2, { ctrl: false, shift: false });
    press('s');
    press(' ');
    expect(input.typeSearch?.state.text).toBe('s ');
    input.dispose();
  });

  it('没接打字即跳时字母不拦', () => {
    const { press, input } = setup({ focus: 1, typing: false });
    expect(input.typeSearch).toBeNull();
    expect(press('g')).toBe(false);
  });

  it('移动键落焦点并清掉打字即跳的串', () => {
    const { sink, press, input } = setup({ focus: 1 });
    press('b');
    expect(press('ArrowDown')).toBe(true);
    expect(sink.land).toHaveBeenLastCalledWith(3, { ctrl: false, shift: false });
    expect(input.typeSearch?.state.text).toBe('');
    input.dispose();
  });

  it('回车在曲目行上播放、在分组头上开合；Ctrl+A 全选', () => {
    const row = setup({ focus: 2 });
    row.press('Enter');
    expect(row.sink.play).toHaveBeenCalledWith(2);
    const header = setup({ focus: 0 });
    header.press('Enter');
    expect(header.sink.toggleGroup).toHaveBeenCalledWith(0);
    expect(header.press('a', { ctrlKey: true })).toBe(true);
    expect(header.sink.selectAll).toHaveBeenCalled();
  });

  it('不归表格的键不拦缺省，命令登记处照常接手', () => {
    const { press, sink } = setup({ focus: 2 });
    expect(press('ArrowLeft', { altKey: true })).toBe(false);
    expect(press('Escape')).toBe(false);
    expect(press('F5')).toBe(false);
    expect(sink.land).not.toHaveBeenCalled();
  });

  it('Menu 键在松开时开焦点那一条的菜单，没有焦点只拦缺省', () => {
    const { input, sink } = setup({ focus: 2 });
    const event = { key: 'ContextMenu', preventDefault: vi.fn() };
    input.keyup(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(sink.menu).toHaveBeenCalledWith(2);
    const empty = setup();
    const bare = { key: 'ContextMenu', preventDefault: vi.fn() };
    empty.input.keyup(bare);
    expect(bare.preventDefault).toHaveBeenCalled();
    expect(empty.sink.menu).not.toHaveBeenCalled();
  });

  it('Shift+F10 按下时就开菜单', () => {
    const { press, sink } = setup({ focus: 0 });
    expect(press('F10', { shiftKey: true })).toBe(true);
    expect(sink.menu).toHaveBeenCalledWith(0);
  });

  it('开着打字即跳时，串空着的 * 仍是展开同级；串里有字时 * 接着打', () => {
    const { press, sink, input } = setup({ focus: 0 });
    expect(press('*', { shiftKey: true })).toBe(true);
    expect(sink.expandSiblings).toHaveBeenCalledWith(0);
    expect(input.typeSearch?.state.text).toBe('');
    press('s');
    press('*', { shiftKey: true });
    expect(input.typeSearch?.state.text).toBe('s*');
    input.dispose();
  });

  it('Shift 本身不打断打字，大写照原样进串；Alt+字母不进打字即跳', () => {
    const { press, input } = setup({ focus: 1 });
    press('b');
    expect(press('Shift', { shiftKey: true })).toBe(false);
    press('L', { shiftKey: true });
    expect(input.typeSearch?.state.text).toBe('bL');
    input.typeSearch?.clear();
    expect(press('g', { altKey: true })).toBe(false);
    expect(input.typeSearch?.state.text).toBe('');
    input.dispose();
  });
});

describe('调用方给的打字即跳', () => {
  /** 调用方的那一个：只记下收到的串，找到与否由它自己定，这里一律当没找到。 */
  function external() {
    const search = createTypeSearch(
      () => undefined,
      () => {},
    );
    return { search, dispose: vi.spyOn(search, 'dispose') };
  }

  it('没有 rank 时可打印字符交给它，串里有字时空格也归它', () => {
    const { search } = external();
    const { press, input, sink } = setup({ focus: 2, typing: false, external: search });
    expect(input.typeSearch).toBe(search);
    expect(press('b')).toBe(true);
    expect(press(' ')).toBe(true);
    expect(search.state.text).toBe('b ');
    expect(sink.land).not.toHaveBeenCalled();
    search.dispose();
  });

  it('处理了表格键就清它的串；表格释放时不替它释放', () => {
    const { search, dispose } = external();
    const { press, input, sink } = setup({ focus: 2, typing: false, external: search });
    press('b');
    expect(press('ArrowDown')).toBe(true);
    expect(sink.land).toHaveBeenLastCalledWith(3, { ctrl: false, shift: false });
    expect(search.state.text).toBe('');
    input.dispose();
    expect(dispose).not.toHaveBeenCalled();
    search.dispose();
  });

  it('给了 rank 时用表格自己建的那一个，不看调用方给的', () => {
    const { search } = external();
    const { press, input } = setup({ focus: 1, external: search });
    press('g');
    expect(input.typeSearch).not.toBe(search);
    expect(input.typeSearch?.state.text).toBe('g');
    expect(search.state.text).toBe('');
    input.dispose();
    search.dispose();
  });
});
