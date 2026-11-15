import { Button, Tooltip } from '@fluentui/react-components';
import { Checkmark16Regular, Copy16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type CompositionEvent,
  type KeyboardEvent,
  type Ref,
  type SyntheticEvent,
  type UIEvent,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import styles from './QueryEditor.module.css';
import { fillQuery, needsConnector } from './queryPresets.ts';
import { insertEntry } from './syntax/queryComplete.ts';
import type { Region } from './syntax/queryLexer.ts';
import { CompletionPopup, HintBubble, optionId } from './syntax/SyntaxPopups.tsx';
import { SyntaxLayer } from './syntax/SyntaxLayer.tsx';
import { useCopied } from './syntax/syntaxCopy.ts';
import { hintAt } from './syntax/syntaxHint.ts';
import type { ReferenceItem } from './syntax/syntaxReference.ts';
import { useSyntaxCompletion } from './syntax/useSyntaxCompletion.ts';

/** `query` 是 fb2k 查询；`sort` 整段是 Title Formatting，没有 `SORT BY`，补全只给字段与函数 */
export type QueryEditorKind = 'query' | 'sort';

export interface QueryEditorHandle {
  /** 把参考栏里点中的一行落在光标处并选中占位段，焦点回到编辑器；排序框收不下的整句写法不做事 */
  insertReference(item: ReferenceItem): void;
  focus(): void;
}

export interface QueryEditorProps {
  readonly value: string;
  readonly kind: QueryEditorKind;
  /** 无障碍名称 */
  readonly label: string;
  readonly placeholder?: string;
  /** 宿主认不出这串查询 */
  readonly invalid?: boolean;
  /** foo_playcount 确认没装：补全里依赖它的字段标签变警示色 */
  readonly playcountMissing?: boolean;
  /** 随内容长高，最少与最多各几行；超出最多行数的内容在框里滚 */
  readonly minRows: number;
  readonly maxRows: number;
  readonly handle?: Ref<QueryEditorHandle>;
  onChange(text: string): void;
  /** `Ctrl+Enter`；补全列表开着时它仍是提交，`Enter` 才是接受补全 */
  onSubmit?(): void;
  onFocus?(): void;
}

const REGION_OF: Readonly<Record<QueryEditorKind, Region>> = { query: 'query', sort: 'format' };

/**
 * 多行的查询与排序编辑器：文字按语法着色，边写边补全与提示。输入元素的字是透明的，看到的是它后面着色的
 * 那一层，两层的字体、内边距与折行规则一致，纵向滚动由输入元素带着走；输入法组词期间只更新本地显示，
 * 不把中间输入发布出去
 * 文字由调用方持有；`Enter` 换行，补全列表开着时它接受补全；复制键由调用方放在标题行（`QueryCopyButton`）
 * 接受补全与参考栏插入都经浏览器的编辑命令写入，撤销与重做才接得上；直接给 value 赋值会清空撤销栈
 */
export function QueryEditor(props: QueryEditorProps) {
  const t = useAtomValueRawSync(translateAtom);
  const id = useId();
  const region = REGION_OF[props.kind];
  const input = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const selectAfter = useRef<readonly [number, number] | null>(null);
  const composing = useRef(false);
  /** 输入元素还没拿过焦点时它的选区不是用户放的，参考栏插入要落在末尾 */
  const placed = useRef(false);
  const [composition, setComposition] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  /** 正在经编辑命令写入：这一下 input 事件只把文字发布出去，不重算补全 */
  const writing = useRef(false);
  const syntax = useSyntaxCompletion(region);
  const shown = composition ?? props.value;
  const hint = useMemo(
    () => (focused ? hintAt(shown, caret, t, region) : null),
    [focused, shown, caret, t, region],
  );

  useLayoutEffect(() => {
    const range = selectAfter.current;
    if (range) {
      selectAfter.current = null;
      input.current?.setSelectionRange(range[0], range[1]);
    }
    if (layer.current && input.current) layer.current.scrollTop = input.current.scrollTop;
  });

  /**
   * 把文字换成 `text` 并让输入元素选中 `range`；落字后补全收起
   * 只替换前后相同之外变了的那一段，用 `insertText` 写进输入元素：它进浏览器的撤销栈，`Ctrl+Z`、
   * `Ctrl+Y` 能接上；写不进（命令不可用）才退回直接给 value 赋值
   */
  const write = (text: string, range: readonly [number, number]) => {
    syntax.close();
    const field = input.current;
    if (!field) return;
    field.focus();
    const old = field.value;
    let head = 0;
    while (head < old.length && head < text.length && old[head] === text[head]) head += 1;
    let tail = 0;
    while (
      tail < old.length - head &&
      tail < text.length - head &&
      old[old.length - 1 - tail] === text[text.length - 1 - tail]
    ) {
      tail += 1;
    }
    field.setSelectionRange(head, old.length - tail);
    const inserted = text.slice(head, text.length - tail);
    writing.current = true;
    const done = document.execCommand(inserted === '' ? 'delete' : 'insertText', false, inserted);
    writing.current = false;
    if (done && field.value === text) return field.setSelectionRange(range[0], range[1]);
    selectAfter.current = range;
    props.onChange(text);
  };

  // 不给依赖：句柄每次渲染换新，读到的总是最新的文字
  useImperativeHandle(props.handle, () => ({
    focus: () => input.current?.focus(),
    insertReference(item) {
      const end = placed.current
        ? (input.current?.selectionEnd ?? props.value.length)
        : props.value.length;
      const start = placed.current ? (input.current?.selectionStart ?? end) : end;
      if (item.kind === 'snippet') {
        if (props.kind !== 'query') return;
        const filled = fillQuery(props.value, item.snippet, needsConnector(item.snippet.id));
        return write(filled.text, [filled.start, filled.end]);
      }
      const filled = insertEntry(props.value, start, end, item.entry, region);
      write(filled.text, [filled.start, filled.end]);
    },
  }));

  const pick = (at: number) => {
    const item = syntax.completion?.items[at];
    const filled = item && syntax.pick(shown, item);
    if (filled) write(filled.text, [filled.start, filled.end]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || event.nativeEvent.isComposing) return;
    const result = syntax.key(event, shown, event.currentTarget.selectionStart ?? shown.length);
    if (result.handled) {
      event.preventDefault();
      if (result.filled) write(result.filled.text, [result.filled.start, result.filled.end]);
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      props.onSubmit?.();
    }
  };
  /** 文字改了：发布给调用方，再按光标处重新算补全 */
  const typedText = (text: string, at: number | null) => {
    if (composing.current) return setComposition(text);
    props.onChange(text);
    if (writing.current) return;
    const caretAt = at ?? text.length;
    setCaret(caretAt);
    syntax.typed(text, caretAt);
  };

  const limits = { '--editor-min-rows': props.minRows, '--editor-max-rows': props.maxRows };
  return (
    <div className={styles.root}>
      <div
        ref={setFrame}
        className={styles.frame}
        style={limits as CSSProperties}
        data-invalid={props.invalid || undefined}
        data-query-editor={props.kind}
      >
        <SyntaxLayer
          text={shown}
          caret={caret}
          anchorAt={syntax.completion?.from ?? null}
          layer={layer}
          anchor={setAnchor}
          region={region}
          multiline
        />
        <textarea
          ref={input}
          className={styles.input}
          rows={props.minRows}
          aria-label={props.label}
          aria-invalid={props.invalid || undefined}
          aria-autocomplete="list"
          aria-controls={syntax.completion ? id : undefined}
          aria-activedescendant={syntax.completion ? optionId(id, syntax.active) : undefined}
          placeholder={props.placeholder}
          spellCheck={false}
          autoComplete="off"
          value={shown}
          onChange={(event) => typedText(event.target.value, event.target.selectionStart)}
          onCompositionStart={() => {
            composing.current = true;
            setComposition(props.value);
          }}
          onCompositionEnd={(event: CompositionEvent<HTMLTextAreaElement>) => {
            composing.current = false;
            setComposition(null);
            typedText(event.currentTarget.value, event.currentTarget.selectionStart);
          }}
          onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) => {
            const at = event.currentTarget.selectionStart;
            setCaret(at);
            syntax.moved(at);
          }}
          onScroll={(event: UIEvent<HTMLTextAreaElement>) => {
            if (layer.current) layer.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onFocus={() => {
            placed.current = true;
            setFocused(true);
            props.onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            syntax.close();
          }}
          onKeyDown={onKeyDown}
          data-query-input
        />
      </div>
      {focused && syntax.completion && anchor && (
        <CompletionPopup
          listId={id}
          completion={syntax.completion}
          active={syntax.active}
          target={anchor}
          playcountMissing={props.playcountMissing ?? false}
          onPick={pick}
          onActive={syntax.setActive}
        />
      )}
      {hint && !syntax.completion && frame && <HintBubble hint={hint} target={frame} />}
    </div>
  );
}

/** 标题行右端的复制键：把 `text` 放进剪贴板，成功后图标短暂变成对勾；文字空时置灰 */
export function QueryCopyButton({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}) {
  const [copied, copy] = useCopied();
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        size="small"
        icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
        disabled={text === ''}
        onClick={() => copy(text)}
        data-query-copy
      />
    </Tooltip>
  );
}
