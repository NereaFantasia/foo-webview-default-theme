import {
  Button,
  Input,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  Dismiss16Regular,
  Search16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent,
  type Ref,
  type RefObject,
  type SyntheticEvent,
  type UIEvent,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useReportSearchWidth } from '../kit/commandBarSearch.ts';
import { ON_OFF, defineLocalPref } from '../kit/localPref.ts';
import { useCommand } from '../nav/useCommand.ts';
import styles from './QueryBox.module.css';
import { fillQuery, needsConnector, type QuerySnippet } from './queryPresets.ts';
import { changeQueryText, queryInputText, type QueryInput } from './queryInput.ts';
import { QueryScopeMenu } from './QueryScopeMenu.tsx';
import type { QueryScope } from './trackQuery.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { insertEntry } from './syntax/queryComplete.ts';
import { CompletionPopup, HintBubble, optionId } from './syntax/SyntaxPopups.tsx';
import { SyntaxReferencePanel } from './syntax/SyntaxReference.tsx';
import { SyntaxFrame, SyntaxLayer } from './syntax/SyntaxLayer.tsx';
import { useCopied } from './syntax/syntaxCopy.ts';
import { hintAt } from './syntax/syntaxHint.ts';
import type { ReferenceItem } from './syntax/syntaxReference.ts';
import { useSyntaxCompletion } from './syntax/useSyntaxCompletion.ts';

const useStyles = makeStyles({
  control: { flexShrink: 0, whiteSpace: 'nowrap' },
  trailing: { flexShrink: 0, alignItems: 'center' },
  surface: {
    height: '32px',
    minWidth: 0,
    flex: 1,
  },
  clear: { display: 'none' },
  invalid: {
    '&:focus-within, &:hover:focus-within': shorthands.borderColor(tokens.colorPaletteRedBorder2),
    '&::after, &:focus-within:active::after': { borderBottomColor: tokens.colorPaletteRedBorder2 },
  },
  // 高级查询自画的外壳：版式与 Fluent 的输入框一致，底色与边框色由 `controls.field` 给，焦点下划线照它的做法
  chrome: {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'nowrap',
    columnGap: tokens.spacingHorizontalXXS,
    height: '32px',
    minWidth: 0,
    flex: 1,
    paddingLeft: tokens.spacingHorizontalMNudge,
    paddingRight: tokens.spacingHorizontalMNudge,
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopWidth: tokens.strokeWidthThin,
    borderRightWidth: tokens.strokeWidthThin,
    borderBottomWidth: tokens.strokeWidthThin,
    borderLeftWidth: tokens.strokeWidthThin,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    '::after': {
      boxSizing: 'border-box',
      content: '""',
      position: 'absolute',
      left: '-1px',
      right: '-1px',
      bottom: '-1px',
      height: 'max(2px, var(--borderRadiusMedium))',
      borderBottomLeftRadius: tokens.borderRadiusMedium,
      borderBottomRightRadius: tokens.borderRadiusMedium,
      borderBottom: `2px solid ${tokens.colorCompoundBrandStroke}`,
      clipPath: 'inset(calc(100% - 2px) 0 0 0)',
      transform: 'scaleX(0)',
      transitionProperty: 'transform',
      transitionDuration: tokens.durationUltraFast,
      transitionDelay: tokens.curveAccelerateMid,
    },
    ':focus-within::after': {
      transform: 'scaleX(1)',
      transitionDuration: tokens.durationNormal,
      transitionDelay: tokens.curveDecelerateMid,
    },
    ':focus-within': { outline: '2px solid transparent' },
  },
});

/** 语法参考面板是否固定：固定后点外面不收，可以连着点；存档不可用时保留本次选择 */
const pinPref = defineLocalPref<boolean>({
  key: 'default-theme.query-reference.v1',
  fallback: false,
  ...ON_OFF,
});

/** 语句末尾给打字和光标留的余地，像素：着色层左右各 2 的内边距，再多两个字的位置 */
const TYPING_ROOM = 24;

export interface QueryBoxHandle {
  /** 直接打开语法参考，焦点回到输入框；不在高级查询时不做事 */
  openReference(): void;
}

const ignore = () => {};

export interface QueryBoxProps {
  readonly input: QueryInput;
  /** 普通搜索按哪个字段找，缺省全部；不分字段的页面（`scopes` 为 false）不传 */
  readonly scope?: QueryScope;
  /** 宿主认不出框里这串查询 */
  readonly invalid: boolean;
  /** 末尾那份范围与模式菜单开着没有；页面的「查询帮助」靠它打开 */
  readonly menuOpen: boolean;
  readonly placeholder: string;
  readonly label: string;
  /** foo_playcount 确认没装：补全与参考里依赖它的字段标签变警示色；没探出来或没传时按装了处理 */
  readonly playcountMissing?: boolean;
  /** 普通搜索分不分字段，默认分；不分时（专辑页）末尾的菜单只剩高级查询与语法参考 */
  readonly scopes?: boolean;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  /** 页面要从外面打开语法参考（查询出错的提示条上的键）时用 */
  readonly handle?: Ref<QueryBoxHandle>;
  readonly onChange: (input: QueryInput) => void;
  /** 回车；没有「马上查」可做的页面不传 */
  readonly onEnter?: () => void;
  readonly onScope?: (scope: QueryScope) => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}

/**
 * 命令栏的搜索框：只管输入文字。末尾的键切换搜索范围与高级查询
 * 高级查询时文字按语法着色，边写边补全与提示，菜单里可以打开语法参考、框尾可以复制语句
 * 模式与两份草稿由页面持有；输入法组词期间只更新本地显示，不发布中间输入
 */
export function QueryBox(props: QueryBoxProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const value = queryInputText(props.input);
  const id = useId();
  const own = useRef<HTMLInputElement>(null);
  const input = props.inputRef ?? own;
  const layer = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLSpanElement>(null);
  const reportWidth = useReportSearchWidth();
  const selectAfter = useRef<readonly [number, number] | null>(null);
  const restoreFocus = useRef(false);
  const composing = useRef(false);
  const [composition, setComposition] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [pinned, setPinned] = useState(() => pinPref.read());
  const [copied, copy] = useCopied();
  const syntax = useSyntaxCompletion();
  const advanced = props.input.mode === 'advanced';
  const shown = composition ?? value;
  useImperativeHandle(
    props.handle,
    () => ({
      openReference() {
        if (!advanced) return;
        setReferenceOpen(true);
        input.current?.focus();
      },
    }),
    [advanced, input],
  );
  const hint = useMemo(
    () => (advanced && focused ? hintAt(shown, caret, t) : null),
    [advanced, focused, shown, caret, t],
  );

  useLayoutEffect(() => {
    const range = selectAfter.current;
    if (range) {
      selectAfter.current = null;
      input.current?.setSelectionRange(range[0], range[1]);
    }
    if (layer.current && input.current) layer.current.scrollLeft = input.current.scrollLeft;
    // 高级查询的框随语句加宽：框要的宽度是框内除文字外的部分加文字本身；语句短时命令栏仍用定宽
    const text = layer.current?.firstElementChild;
    const frame = layer.current?.parentElement;
    if (advanced && text && frame && field.current) {
      const chrome = field.current.offsetWidth - frame.clientWidth;
      reportWidth(Math.ceil(chrome + text.getBoundingClientRect().width + TYPING_ROOM));
    } else {
      reportWidth(null);
    }
  });
  useLayoutEffect(() => () => reportWidth(null), [reportWidth]);

  // 高级查询与文字搜索是两个输入元素，换模式会重新挂载，焦点要在挂载之后还回去
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    input.current?.focus();
  }, [advanced, input]);

  useCommand({
    id: `query.clear.${id}`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () =>
      !props.menuOpen &&
      !referenceOpen &&
      !syntax.openRef.current &&
      !composing.current &&
      value !== '' &&
      document.activeElement === input.current,
    run: () => props.onChange(changeQueryText(props.input, '')),
  });

  /** 把文字写回页面并让输入框选中 `range`；落字后补全收起 */
  const write = (text: string, range: readonly [number, number]) => {
    selectAfter.current = range;
    syntax.close();
    props.onChange(changeQueryText(props.input, text));
    input.current?.focus();
  };
  const snippet = (piece: QuerySnippet) => {
    const filled = fillQuery(props.input.advancedText, piece, needsConnector(piece.id));
    selectAfter.current = [filled.start, filled.end];
    props.onChange({ ...props.input, mode: 'advanced', advancedText: filled.text });
    input.current?.focus();
  };
  const insertReference = (item: ReferenceItem) => {
    if (item.kind === 'snippet') return snippet(item.snippet);
    const start = input.current?.selectionStart ?? shown.length;
    const end = input.current?.selectionEnd ?? start;
    const filled = insertEntry(shown, start, end, item.entry);
    write(filled.text, [filled.start, filled.end]);
  };
  const pick = (at: number) => {
    const item = syntax.completion?.items[at];
    const filled = item && syntax.pick(shown, item);
    if (filled) write(filled.text, [filled.start, filled.end]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing) return;
    if (advanced) {
      const at = event.currentTarget.selectionStart ?? shown.length;
      const result = syntax.key(event, shown, at);
      if (result.handled) {
        event.preventDefault();
        if (result.filled) write(result.filled.text, [result.filled.start, result.filled.end]);
        return;
      }
    }
    if (event.altKey && event.key === 'ArrowDown') props.onMenuOpenChange(true);
    else if (event.key === 'Enter') props.onEnter?.();
    else return;
    event.preventDefault();
  };
  /** 文字改了：发布给页面；高级查询时再按光标处重新算补全 */
  const typedText = (text: string, at: number | null) => {
    if (composing.current) return setComposition(text);
    props.onChange(changeQueryText(props.input, text));
    if (!advanced) return;
    const caretAt = at ?? text.length;
    setCaret(caretAt);
    syntax.typed(text, caretAt);
  };

  // 两种输入元素共用的属性
  const common = {
    ref: input,
    role: 'searchbox',
    'aria-label': props.label,
    'aria-invalid': props.invalid || undefined,
    value: shown,
    onCompositionStart: () => {
      composing.current = true;
      setComposition(value);
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      composing.current = false;
      setComposition(null);
      typedText(event.currentTarget.value, event.currentTarget.selectionStart);
    },
    onSelect: (event: SyntheticEvent<HTMLInputElement>) => {
      const at = event.currentTarget.selectionStart ?? 0;
      setCaret(at);
      syntax.moved(at);
    },
    onScroll: (event: UIEvent<HTMLInputElement>) => {
      if (layer.current) layer.current.scrollLeft = event.currentTarget.scrollLeft;
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      syntax.close();
    },
    onKeyDown,
    'data-query-input': true,
  } as const;

  const trailing = (
    <>
      <Tooltip content={t('query.clear')} relationship="label">
        <Button
          className={mergeClasses(classes.control, value === '' && classes.clear, controls.icon)}
          appearance="transparent"
          size="small"
          icon={<Dismiss16Regular />}
          disabled={value === ''}
          tabIndex={value === '' ? -1 : undefined}
          aria-hidden={value === '' || undefined}
          onClick={() => {
            syntax.close();
            props.onChange(changeQueryText(props.input, ''));
            input.current?.focus();
          }}
          data-query-clear
        />
      </Tooltip>
      {advanced && (
        <Tooltip content={t('query.syntax.copyQuery')} relationship="label">
          <Button
            className={mergeClasses(classes.control, controls.icon)}
            appearance="transparent"
            size="small"
            icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
            disabled={value === ''}
            onClick={() => copy(value)}
            data-query-copy
          />
        </Tooltip>
      )}
      <QueryScopeMenu
        scope={props.scope ?? 'all'}
        onScope={props.onScope ?? ignore}
        scopes={props.scopes}
        open={props.menuOpen}
        onOpenChange={props.onMenuOpenChange}
        advanced={{
          active: advanced,
          invalid: props.invalid,
          onMode: (next) => {
            if (!next) setReferenceOpen(false);
            syntax.close();
            restoreFocus.current = true;
            props.onChange({ ...props.input, mode: next ? 'advanced' : 'text' });
          },
          onReference: () => setReferenceOpen(true),
        }}
      />
    </>
  );

  return (
    <div className={styles.box} ref={setBox} data-query-box>
      {advanced ? (
        <span
          ref={field}
          className={mergeClasses(classes.chrome, props.invalid && classes.invalid, controls.field)}
          data-query-field
        >
          <Search16Regular className={styles.icon} />
          <SyntaxFrame>
            <SyntaxLayer
              text={shown}
              caret={caret}
              anchorAt={syntax.completion?.from ?? null}
              layer={layer}
              anchor={setAnchor}
            />
            <input
              {...common}
              className={styles.input}
              placeholder={t('query.mode')}
              aria-autocomplete="list"
              aria-controls={syntax.completion ? id : undefined}
              aria-activedescendant={syntax.completion ? optionId(id, syntax.active) : undefined}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => typedText(event.target.value, event.target.selectionStart)}
            />
          </SyntaxFrame>
          <span className={styles.trailing}>{trailing}</span>
        </span>
      ) : (
        <Input
          {...common}
          className={mergeClasses(
            classes.surface,
            props.invalid && classes.invalid,
            controls.field,
          )}
          placeholder={props.placeholder}
          onChange={(event, data) => typedText(data.value, event.target.selectionStart)}
          contentBefore={<Search16Regular />}
          contentAfter={{ className: classes.trailing, children: trailing }}
        />
      )}
      {advanced && focused && syntax.completion && anchor && (
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
      {hint && !syntax.completion && !referenceOpen && box && (
        <HintBubble hint={hint} target={box} />
      )}
      <SyntaxReferencePanel
        open={advanced && referenceOpen}
        pinned={pinned}
        target={box}
        playcountMissing={props.playcountMissing ?? false}
        onClose={() => setReferenceOpen(false)}
        onPinned={(next) => {
          setPinned(next);
          pinPref.write(next);
        }}
        onInsert={insertReference}
      />
    </div>
  );
}
