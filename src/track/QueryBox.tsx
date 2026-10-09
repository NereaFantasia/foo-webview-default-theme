import {
  Badge,
  Button,
  Input,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  Code16Regular,
  Dismiss16Regular,
  Filter16Filled,
  Filter16Regular,
} from '@fluentui/react-icons';
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
import { QueryMenu, queryOptionId } from './QueryMenu.tsx';
import { queryMenuEntries, stepEntry, type QueryMenuEntry } from './queryMenuEntries.ts';
import { fillQuery, needsConnector, type PresetId, type QuerySnippet } from './queryPresets.ts';
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
  toggle: { width: '32px', minWidth: '32px', height: '32px', flexShrink: 0 },
  funnel: { width: '40px', minWidth: '40px' },
  clear: { visibility: 'hidden', pointerEvents: 'none' },
  active: { color: tokens.colorBrandForeground1 },
  invalid: {
    '&:focus-within, &:hover:focus-within': shorthands.borderColor(tokens.colorPaletteRedBorder2),
    '&::after, &:focus-within:active::after': { borderBottomColor: tokens.colorPaletteRedBorder2 },
  },
});

export interface QueryBoxProps {
  readonly input: QueryInput;
  readonly scope: QueryScope;
  /** 勾上的预设数与菜单开合状态独立。 */
  readonly checked: ReadonlySet<PresetId>;
  /** 装没装 foo_playcount；没装时要它的那一节预设置灰。 */
  readonly playcount: boolean | null;
  /** 宿主认不出框里这串查询。 */
  readonly invalid: boolean;
  readonly menuOpen: boolean;
  readonly placeholder: string;
  readonly label: string;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly onChange: (input: QueryInput) => void;
  /** 回车，且没有落在菜单的某一条上。 */
  readonly onEnter: () => void;
  readonly onScope: (scope: QueryScope) => void;
  readonly onTogglePreset: (id: PresetId) => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}

/** 模式与两份草稿由页面持有；输入法组词期间只更新本地显示，不发布中间输入。 */
export function QueryBox(props: QueryBoxProps) {
  const controls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const { scope, menuOpen, onMenuOpenChange } = props;
  const value = queryInputText(props.input);
  const menuId = useId();
  const own = useRef<HTMLInputElement>(null);
  const input = props.inputRef ?? own;
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(-1);
  const selectAfter = useRef<readonly [number, number] | null>(null);
  const composing = useRef(false);
  const [composition, setComposition] = useState<string | null>(null);
  const advanced = props.input.mode === 'advanced';
  const invalid = props.invalid;
  const connectable = props.input.advancedText.trim() !== '';
  const entries = queryMenuEntries({
    playcount: props.playcount,
    connectable,
  });
  const shown = menuOpen && entries.length > 0;

  useLayoutEffect(() => {
    const range = selectAfter.current;
    if (!range) return;
    selectAfter.current = null;
    input.current?.setSelectionRange(range[0], range[1]);
  });

  useCommand({
    id: `query.clear.${menuId}`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled: () =>
      !menuOpen && !composing.current && value !== '' && document.activeElement === input.current,
    run: () => props.onChange(changeQueryText(props.input, '')),
  });

  const open = (next: boolean) => {
    setActive(-1);
    if (next !== menuOpen) onMenuOpenChange(next);
  };
  const fill = (piece: Pick<QuerySnippet, 'text' | 'select'>, connector: boolean) => {
    const filled = fillQuery(props.input.advancedText, piece, connector);
    selectAfter.current = [filled.start, filled.end];
    props.onChange({ ...props.input, mode: 'advanced', advancedText: filled.text });
    open(false);
    input.current?.focus();
  };
  const pick = (entry: QueryMenuEntry) => {
    if (entry.kind === 'preset') props.onTogglePreset(entry.preset.id);
    else fill(entry.snippet, needsConnector(entry.snippet.id));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing) return;
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const entry = entries[active];
    if (shown && step !== 0) setActive(stepEntry(entries, active, step));
    else if (shown && event.key === 'Enter' && entry && !entry.disabled) pick(entry);
    else if (menuOpen && event.key === 'Escape') open(false);
    else if (!menuOpen && event.altKey && event.key === 'ArrowDown') open(true);
    else if (event.key === 'Enter') props.onEnter();
    else return;
    event.preventDefault();
  };

  const count = props.checked.size;
  const funnel = count > 0 ? t('query.openWithCount', { count }) : t('query.open');
  return (
    <div ref={setBox} className={styles.box} data-query-box>
      <Input
        ref={input}
        className={mergeClasses(classes.surface, invalid && classes.invalid, controls.field)}
        role="combobox"
        aria-label={props.label}
        aria-invalid={invalid || undefined}
        aria-expanded={shown}
        aria-controls={shown ? menuId : undefined}
        aria-activedescendant={shown && active >= 0 ? queryOptionId(menuId, active) : undefined}
        aria-autocomplete="list"
        placeholder={advanced ? t('query.mode') : props.placeholder}
        value={composition ?? value}
        onChange={(_, data) => {
          setActive(-1);
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
        onBlur={() => open(false)}
        contentBefore={
          <Tooltip content={funnel} relationship="label">
            <Button
              appearance="transparent"
              size="small"
              className={mergeClasses(classes.funnel, menuOpen && classes.active, controls.icon)}
              icon={menuOpen ? <Filter16Filled /> : <Filter16Regular />}
              aria-expanded={shown}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                input.current?.focus();
                open(!menuOpen);
              }}
              data-query-funnel
            >
              {count > 0 ? count : undefined}
            </Button>
          </Tooltip>
        }
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
              {advanced ? (
                <Badge
                  className={classes.control}
                  appearance="tint"
                  color={props.invalid ? 'danger' : 'brand'}
                  data-query-mode={props.invalid ? 'invalid' : 'query'}
                >
                  {props.invalid ? t('query.modeInvalid') : t('query.mode')}
                </Badge>
              ) : (
                <QueryScopeMenu scope={scope} onScope={props.onScope} />
              )}
            </>
          ),
        }}
        data-query-input
      />
      <Tooltip content={t('query.advanced')} relationship="label">
        <ToggleButton
          className={mergeClasses(classes.toggle, controls.icon)}
          appearance="subtle"
          checked={advanced}
          icon={<Code16Regular />}
          disabled={composition !== null}
          data-query-mode-toggle
          onClick={() => {
            open(false);
            props.onChange({ ...props.input, mode: advanced ? 'text' : 'advanced' });
            input.current?.focus();
          }}
        />
      </Tooltip>
      <QueryMenu
        open={shown}
        onDismiss={() => open(false)}
        target={box}
        id={menuId}
        entries={entries}
        active={active}
        onActive={setActive}
        checked={props.checked}
        onPick={pick}
        onEdit={(entry) => entry.kind === 'preset' && fill({ text: entry.preset.query }, true)}
      />
    </div>
  );
}
