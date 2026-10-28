import {
  Button,
  Input,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { Dismiss16Regular, Search16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useCommand } from '../nav/useCommand.ts';
import styles from './QueryBox.module.css';
import { fillQuery, needsConnector, type QuerySnippet } from './queryPresets.ts';
import { changeQueryText, queryInputText, type QueryInput } from './queryInput.ts';
import { QueryScopeMenu } from './QueryScopeMenu.tsx';
import type { QueryScope } from './trackQuery.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

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
});

export interface QueryBoxProps {
  readonly input: QueryInput;
  readonly scope: QueryScope;
  /** 宿主认不出框里这串查询 */
  readonly invalid: boolean;
  /** 末尾那份范围与模式菜单开着没有；页面的「查询帮助」靠它打开 */
  readonly menuOpen: boolean;
  readonly placeholder: string;
  readonly label: string;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly onChange: (input: QueryInput) => void;
  /** 回车 */
  readonly onEnter: () => void;
  readonly onScope: (scope: QueryScope) => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}

/**
 * 命令栏的搜索框：只管输入文字。末尾的键切换搜索范围与高级查询，高级查询时插入语法示例
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
  const selectAfter = useRef<readonly [number, number] | null>(null);
  const composing = useRef(false);
  const [composition, setComposition] = useState<string | null>(null);
  const advanced = props.input.mode === 'advanced';

  useLayoutEffect(() => {
    const range = selectAfter.current;
    if (!range) return;
    selectAfter.current = null;
    input.current?.setSelectionRange(range[0], range[1]);
  });

  useCommand({
    id: `query.clear.${id}`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () =>
      !props.menuOpen &&
      !composing.current &&
      value !== '' &&
      document.activeElement === input.current,
    run: () => props.onChange(changeQueryText(props.input, '')),
  });

  const snippet = (piece: QuerySnippet) => {
    const filled = fillQuery(props.input.advancedText, piece, needsConnector(piece.id));
    selectAfter.current = [filled.start, filled.end];
    props.onChange({ ...props.input, mode: 'advanced', advancedText: filled.text });
    input.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.altKey && event.key === 'ArrowDown') props.onMenuOpenChange(true);
    else if (event.key === 'Enter') props.onEnter();
    else return;
    event.preventDefault();
  };

  return (
    <div className={styles.box} data-query-box>
      <Input
        ref={input}
        className={mergeClasses(classes.surface, props.invalid && classes.invalid, controls.field)}
        role="searchbox"
        aria-label={props.label}
        aria-invalid={props.invalid || undefined}
        placeholder={advanced ? t('query.mode') : props.placeholder}
        value={composition ?? value}
        onChange={(_, data) => {
          if (composing.current) setComposition(data.value);
          else props.onChange(changeQueryText(props.input, data.value));
        }}
        onCompositionStart={() => {
          composing.current = true;
          setComposition(value);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setComposition(null);
          props.onChange(changeQueryText(props.input, event.currentTarget.value));
        }}
        onKeyDown={onKeyDown}
        contentBefore={<Search16Regular />}
        contentAfter={{
          className: classes.trailing,
          children: (
            <>
              <Tooltip content={t('query.clear')} relationship="label">
                <Button
                  className={mergeClasses(
                    classes.control,
                    value === '' && classes.clear,
                    controls.icon,
                  )}
                  appearance="transparent"
                  size="small"
                  icon={<Dismiss16Regular />}
                  disabled={value === ''}
                  tabIndex={value === '' ? -1 : undefined}
                  aria-hidden={value === '' || undefined}
                  onClick={() => {
                    props.onChange(changeQueryText(props.input, ''));
                    input.current?.focus();
                  }}
                  data-query-clear
                />
              </Tooltip>
              <QueryScopeMenu
                scope={props.scope}
                onScope={props.onScope}
                open={props.menuOpen}
                onOpenChange={props.onMenuOpenChange}
                advanced={{
                  active: advanced,
                  invalid: props.invalid,
                  connectable: props.input.advancedText.trim() !== '',
                  onMode: (next) => {
                    props.onChange({ ...props.input, mode: next ? 'advanced' : 'text' });
                    input.current?.focus();
                  },
                  onSnippet: snippet,
                }}
              />
            </>
          ),
        }}
        data-query-input
      />
    </div>
  );
}
