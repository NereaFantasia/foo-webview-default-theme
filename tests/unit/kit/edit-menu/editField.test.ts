// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copySelection,
  cutSelection,
  editFieldOf,
  pasteText,
  selectAll,
  snapshotOf,
  type EditClipboard,
} from '../../../../src/kit/edit-menu/editField.ts';

function mount<T extends HTMLElement>(element: T): T {
  document.body.appendChild(element);
  return element;
}

function textbox(value: string, start: number, end: number, type = 'text'): HTMLInputElement {
  const input = mount(document.createElement('input'));
  input.type = type;
  input.value = value;
  input.setSelectionRange(start, end);
  return input;
}

function clipboard(
  text: string | null,
  writes = true,
): EditClipboard & {
  readonly written: string[];
} {
  const written: string[] = [];
  return {
    written,
    read: () => Promise.resolve(text),
    write: (value) => {
      written.push(value);
      return Promise.resolve(writes);
    },
  };
}

describe('右键落点所属的文本框', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('文本类 input 与 textarea 就是它们自己', () => {
    const input = mount(document.createElement('input'));
    const search = mount(document.createElement('input'));
    search.type = 'search';
    const area = mount(document.createElement('textarea'));
    expect(editFieldOf(input)).toBe(input);
    expect(editFieldOf(search)).toBe(search);
    expect(editFieldOf(area)).toBe(area);
  });

  it('复选框、按钮、文件框与普通元素都不算', () => {
    for (const type of ['checkbox', 'radio', 'button', 'file', 'range']) {
      const input = mount(document.createElement('input'));
      input.type = type;
      expect(editFieldOf(input)).toBeNull();
    }
    expect(editFieldOf(mount(document.createElement('div')))).toBeNull();
    expect(editFieldOf(null)).toBeNull();
  });

  it('Fluent 输入框点到外面一层的内边距，也落到里面的 input', () => {
    const root = mount(document.createElement('span'));
    root.className = 'fui-Input';
    const input = root.appendChild(document.createElement('input'));
    expect(editFieldOf(root)).toBe(input);
  });

  it('contenteditable 元素按可编辑状态认', () => {
    // jsdom 不实现 isContentEditable，按属性值补上
    const editable = mount(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    const fixed = mount(document.createElement('div'));
    fixed.setAttribute('contenteditable', 'false');
    Object.defineProperty(fixed, 'isContentEditable', { value: false });
    expect(editFieldOf(editable)).toBe(editable);
    expect(editFieldOf(fixed)).toBeNull();
  });
});

describe('打开菜单时记下的状态', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('选区文字、是否为空与只读', () => {
    const input = textbox('hello world', 6, 11);
    expect(snapshotOf(input)).toMatchObject({
      selected: 'world',
      empty: false,
      readOnly: false,
      secret: false,
    });
    input.readOnly = true;
    expect(snapshotOf(input).readOnly).toBe(true);
    expect(snapshotOf(textbox('', 0, 0))).toMatchObject({ selected: '', empty: true });
  });

  it('密码框标为保密，选区文字仍记下，由命令决定不外传', () => {
    expect(snapshotOf(textbox('secret', 0, 6, 'password'))).toMatchObject({
      secret: true,
      selected: 'secret',
    });
  });

  it('restore 把焦点与选区放回原处', () => {
    const input = textbox('hello world', 6, 11);
    const snapshot = snapshotOf(input);
    input.setSelectionRange(0, 0);
    input.blur();
    snapshot.restore();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 11]);
  });
});

describe('剪切、复制、粘贴与全选', () => {
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom 没有 execCommand；成功与否只看调用的参数
    execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand');
    document.body.replaceChildren();
  });

  it('复制写进剪贴板；没有选区与密码框不写', async () => {
    const board = clipboard(null);
    await copySelection(snapshotOf(textbox('hello world', 6, 11)), board);
    await copySelection(snapshotOf(textbox('hello', 2, 2)), board);
    await copySelection(snapshotOf(textbox('secret', 0, 6, 'password')), board);
    expect(board.written).toEqual(['world']);
  });

  it('剪切先写剪贴板、再删选区', async () => {
    const input = textbox('hello world', 6, 11);
    const board = clipboard(null);
    await cutSelection(input, snapshotOf(input), board);
    expect(board.written).toEqual(['world']);
    expect(execCommand).toHaveBeenCalledWith('delete');
  });

  it('剪贴板写失败时原文保留；只读框也不删', async () => {
    const failing = textbox('hello world', 6, 11);
    await cutSelection(failing, snapshotOf(failing), clipboard(null, false));
    const locked = textbox('hello world', 6, 11);
    locked.readOnly = true;
    await cutSelection(locked, snapshotOf(locked), clipboard(null));
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('粘贴在恢复的选区处插入；单行框把换行折成空格，多行框原样', async () => {
    const input = textbox('hello', 5, 5);
    await pasteText(input, snapshotOf(input), clipboard('a\r\nb\nc'));
    expect(execCommand).toHaveBeenLastCalledWith('insertText', false, 'a b c');
    const area = mount(document.createElement('textarea'));
    await pasteText(area, snapshotOf(area), clipboard('a\nb'));
    expect(execCommand).toHaveBeenLastCalledWith('insertText', false, 'a\nb');
  });

  it('剪贴板没有文本或框只读时不粘贴', async () => {
    const input = textbox('hello', 5, 5);
    await pasteText(input, snapshotOf(input), clipboard(null));
    await pasteText(input, snapshotOf(input), clipboard(''));
    input.readOnly = true;
    await pasteText(input, snapshotOf(input), clipboard('x'));
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('全选选中整框内容并把焦点给它', () => {
    const input = textbox('hello world', 3, 3);
    selectAll(input);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 11]);
  });
});
