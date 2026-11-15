/** 能输入文字的元素：文本类 input、textarea 与 contenteditable */
export type EditField = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** 认作文本框的 input 类型；复选框、按钮、文件框等不在其列 */
const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
]);

/** Fluent 的输入框外面还包一层根元素，点到内边距时事件目标是根，不是里面的 input */
const FLUENT_FIELD_ROOT = '.fui-Input, .fui-Textarea, .fui-SpinButton, .fui-Combobox';

function isTextInput(element: Element): element is HTMLInputElement {
  return element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type);
}

/** 右键落点所属的文本框；不在文本框里返回 null */
export function editFieldOf(target: EventTarget | null): EditField | null {
  if (!(target instanceof Element)) return null;
  const direct = target.closest<HTMLElement>('input, textarea, [contenteditable]');
  if (direct) {
    if (direct instanceof HTMLTextAreaElement) return direct;
    if (isTextInput(direct)) return direct;
    return direct.isContentEditable ? direct : null;
  }
  const inner = target
    .closest(FLUENT_FIELD_ROOT)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  return inner && (inner instanceof HTMLTextAreaElement || isTextInput(inner)) ? inner : null;
}

function hasSelectionRange(field: EditField): field is HTMLInputElement | HTMLTextAreaElement {
  return (
    (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
    typeof field.selectionStart === 'number'
  );
}

/** 菜单打开那一刻文本框的状态；菜单取走焦点后，命令按它恢复选区再执行 */
export interface EditSnapshot {
  readonly selected: string;
  readonly empty: boolean;
  readonly readOnly: boolean;
  /** 密码框：不许剪切与复制 */
  readonly secret: boolean;
  restore(): void;
}

export function snapshotOf(field: EditField): EditSnapshot {
  const control = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
  const readOnly = control ? field.readOnly || field.disabled : !field.isContentEditable;
  const secret = field instanceof HTMLInputElement && field.type === 'password';
  const empty = control ? field.value === '' : (field.textContent ?? '') === '';
  if (hasSelectionRange(field)) {
    const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = field;
    return {
      selected: field.value.slice(start ?? 0, end ?? 0),
      empty,
      readOnly,
      secret,
      restore: () => {
        field.focus({ preventScroll: true });
        field.setSelectionRange(start, end, direction ?? undefined);
      },
    };
  }
  // contenteditable，以及不开放选区接口的 input（数字框）：走文档选区
  const selection = field.ownerDocument.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) =>
    selection?.getRangeAt(index).cloneRange(),
  );
  return {
    selected: selection?.toString() ?? '',
    empty,
    readOnly,
    secret,
    restore: () => {
      field.focus({ preventScroll: true });
      const current = field.ownerDocument.getSelection();
      current?.removeAllRanges();
      for (const range of ranges) if (range) current?.addRange(range);
    },
  };
}

/** 宿主剪贴板的纯文本读写；读不到或剪贴板里没有文本时 `read` 答 null，写失败答 false */
export interface EditClipboard {
  read(): Promise<string | null>;
  write(text: string): Promise<boolean>;
}

/** 复制所选文字；密码框与没有选区时不动 */
export async function copySelection(snapshot: EditSnapshot, clipboard: EditClipboard) {
  if (snapshot.secret || snapshot.selected === '') return false;
  return clipboard.write(snapshot.selected);
}

/** 剪切所选文字：写进剪贴板成功才删，写失败时原文保留 */
export async function cutSelection(
  field: EditField,
  snapshot: EditSnapshot,
  clipboard: EditClipboard,
) {
  if (snapshot.readOnly || !(await copySelection(snapshot, clipboard))) return;
  snapshot.restore();
  field.ownerDocument.execCommand('delete');
}

/** 把剪贴板里的文字放到光标处或替换选区；单行输入框与浏览器一致，换行折成空格 */
export async function pasteText(
  field: EditField,
  snapshot: EditSnapshot,
  clipboard: EditClipboard,
) {
  if (snapshot.readOnly) return;
  const text = await clipboard.read();
  if (!text) return;
  snapshot.restore();
  const singleLine = field instanceof HTMLInputElement;
  field.ownerDocument.execCommand(
    'insertText',
    false,
    singleLine ? text.replace(/\r?\n/g, ' ') : text,
  );
}

export function selectAll(field: EditField): void {
  field.focus({ preventScroll: true });
  if (hasSelectionRange(field)) {
    field.select();
    return;
  }
  const selection = field.ownerDocument.getSelection();
  const range = field.ownerDocument.createRange();
  range.selectNodeContents(field);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
