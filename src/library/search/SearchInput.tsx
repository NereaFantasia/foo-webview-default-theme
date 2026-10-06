import { Button, Input, makeStyles, mergeClasses, Tooltip } from '@fluentui/react-components';
import { Dismiss16Regular, Search16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useRef } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { TEXTBOX_KEYS } from '../../kit/textboxKeys.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { SEARCH_TAB_KEYS, useSearchSession } from './searchContext.ts';
import { searchOptionId } from './searchSuggestions.ts';

const useStyles = makeStyles({
  root: { width: '100%', minWidth: 0 },
  hidden: { visibility: 'hidden', pointerEvents: 'none' },
  clear: { minWidth: '24px', width: '24px', height: '24px' },
});

export function SearchInput({ mode = 'sidebar' }: { readonly mode?: 'sidebar' | 'flyout' }) {
  const session = useSearchSession();
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const id = useId();
  const enabled = () => document.activeElement === input.current && !composing.current;
  useCommand({
    id: `${id}.tab`,
    layer: 'input',
    keys: [{ key: 'Tab' }],
    enabled: () =>
      enabled() &&
      mode === 'sidebar' &&
      session.open &&
      !!document.querySelector('[data-search-flyout] button:not(:disabled)'),
    run: () =>
      document.querySelector<HTMLElement>('[data-search-flyout] button:not(:disabled)')?.focus(),
  });
  useCommand({
    id: `${id}.enter`,
    layer: 'input',
    keys: [{ key: 'Enter' }],
    enabled,
    run: () => session.accept(),
  });
  useCommand({
    id: `${id}.down`,
    layer: 'input',
    keys: [{ key: 'ArrowDown' }],
    enabled,
    run: () => session.step(1),
  });
  useCommand({
    id: `${id}.up`,
    layer: 'input',
    keys: [{ key: 'ArrowUp' }],
    enabled,
    run: () => session.step(-1),
  });
  useCommand({
    id: `${id}.escape`,
    layer: 'input',
    keys: [{ key: 'Escape' }],
    enabled,
    run: () => {
      if (session.open) session.close(true);
      else {
        session.edit('');
        session.close();
      }
    },
  });
  return (
    <Input
      root={{ ...(session.open ? SEARCH_TAB_KEYS : {}), className: classes.root }}
      value={session.draft}
      placeholder={t('sidebar.search')}
      contentBefore={<Search16Regular />}
      contentAfter={
        <Tooltip content={t('search.clear')} relationship="label">
          <Button
            className={mergeClasses(classes.clear, !session.draft && classes.hidden)}
            appearance="subtle"
            icon={<Dismiss16Regular />}
            aria-label={t('search.clear')}
            disabled={!session.draft}
            aria-hidden={!session.draft || undefined}
            tabIndex={session.draft ? undefined : -1}
            onClick={() => {
              session.edit('');
              input.current?.focus();
            }}
          />
        </Tooltip>
      }
      onChange={(_, data) => session.edit(data.value, composing.current)}
      input={{
        ref: input,
        role: 'combobox',
        'aria-label': t('sidebar.search'),
        'aria-expanded': session.open,
        'aria-autocomplete': 'list',
        'aria-controls': session.open ? 'global-search-suggestions' : undefined,
        'aria-activedescendant':
          session.open && session.active ? searchOptionId(session.active) : undefined,
        ...{ 'data-search-input': mode },
        ...TEXTBOX_KEYS,
        onFocus: (event) => session.focusInput(event.currentTarget, mode),
        onCompositionStart: () => {
          composing.current = true;
          session.edit(session.draft, true);
        },
        onCompositionEnd: (event) => {
          composing.current = false;
          session.edit(event.currentTarget.value);
        },
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
            event.stopPropagation();
        },
      }}
    />
  );
}
