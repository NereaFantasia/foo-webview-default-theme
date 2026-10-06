import { Button, inputClassNames, Portal, Tooltip } from '@fluentui/react-components';
import { ArrowRight16Regular, Delete16Regular, Dismiss16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { albumDetailNoticeAtom } from '../album-detail/albumDetailOpen.ts';
import { SEARCH_TAB_KEYS, useSearchSession } from './searchContext.ts';
import { SearchFeedback } from './SearchFeedback.tsx';
import { SearchInput } from './SearchInput.tsx';
import { SearchResultRow } from './SearchResultRow.tsx';
import { searchOptionId } from './searchSuggestions.ts';
import { useSearchFlyoutMotion } from './useSearchFlyoutMotion.ts';
import styles from './SearchFlyout.module.css';
import { useService } from '../../kit/useService.ts';
import { searchKey } from './searchServices.ts';

const MAX_WIDTH = 420;

export function SearchFlyout() {
  const session = useSearchSession();
  const search = useService(searchKey);
  const t = useAtomValueRawSync(translateAtom);
  const recent = useAtomValueRawSync(search.recent.state);
  const preview = useAtomValueRawSync(search.preview.state);
  const notice = useAtomValueRawSync(albumDetailNoticeAtom);
  const playNotice = useAtomValueRawSync(search.notice);
  const { panel, present } = useSearchFlyoutMotion(session.open);
  const [box, setBox] = useState({ left: 8, top: 40, width: MAX_WIDTH, maxHeight: 500 });
  const markInside = useLightDismiss({
    id: 'search.dismiss',
    open: session.open,
    panel,
    exempt: (target) => !!target.closest('[data-search-input], [data-search-trigger]'),
    onDismiss: (escape) => session.close(escape),
  });
  useCommand({
    id: 'search.returnToInput',
    layer: 'overlay',
    keys: [{ key: 'Tab', shift: true }],
    enabled: () =>
      session.open &&
      session.mode === 'sidebar' &&
      document.activeElement === panel.current?.querySelector('button:not(:disabled)'),
    run: () => session.anchor?.focus(),
  });
  useLayoutEffect(() => {
    if (!session.open) return;
    const anchor =
      session.mode === 'sidebar'
        ? (session.anchor?.closest(`.${inputClassNames.root}`) ?? session.anchor)
        : session.anchor;
    const measure = () => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(MAX_WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8));
      const top = Math.max(
        8,
        Math.min(
          session.mode === 'sidebar' ? (rect?.bottom ?? 40) + 4 : (rect?.top ?? 40),
          Math.max(8, window.innerHeight - 240),
        ),
      );
      setBox({ left, top, width, maxHeight: Math.max(100, window.innerHeight - top - 96) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (anchor) observer.observe(anchor);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [session.open, session.anchor, session.mode]);
  useLayoutEffect(() => {
    if (session.active)
      document.getElementById(searchOptionId(session.active))?.scrollIntoView({ block: 'nearest' });
  }, [session.active]);
  if (!present) return null;
  return (
    <Portal>
      <div
        ref={panel}
        {...SEARCH_TAB_KEYS}
        style={box}
        className={styles.root}
        data-search-flyout
        inert={!session.open}
        aria-hidden={!session.open || undefined}
        onPointerDownCapture={markInside}
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            !event.currentTarget.contains(next) &&
            !next.closest('[data-search-input]')
          )
            session.close();
        }}
        aria-label={t('search.suggestions')}
      >
        {session.mode === 'flyout' && (
          <div className={styles.input}>
            <SearchInput mode="flyout" />
          </div>
        )}
        {!session.draft.trim() && (
          <div className={styles.heading}>
            <span>{t('search.recent')}</span>
            <Tooltip content={t('search.clearHistory')} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<Delete16Regular />}
                disabled={!recent.items.length}
                aria-label={t('search.clearHistory')}
                onClick={() => {
                  search.recent.clear();
                  session.show('');
                }}
              />
            </Tooltip>
          </div>
        )}
        <div className={styles.scroller}>
          <div
            id="global-search-suggestions"
            role="listbox"
            aria-label={t('search.suggestions')}
            aria-busy={preview.status === 'loading'}
          >
            {(['recent', 'best', 'albums', 'tracks'] as const).map((group) => {
              const rows = session.suggestions.filter((row) => row.group === group);
              if (!rows.length) return null;
              return (
                <div key={group} role="group" aria-label={t(`search.${group}`)}>
                  {group !== 'recent' && (
                    <div className={styles.heading}>{t(`search.${group}`)}</div>
                  )}
                  {rows.map((row) =>
                    row.hit ? (
                      <SearchResultRow
                        key={row.key}
                        hit={row.hit}
                        id={searchOptionId(row.key)}
                        option
                        selected={session.active === row.key}
                        onOpen={() => {
                          session.select(row.key);
                          if (row.hit) session.activate(row.hit, session.draft);
                        }}
                      />
                    ) : (
                      <div key={row.key} className={styles.history}>
                        <div
                          role="option"
                          id={searchOptionId(row.key)}
                          aria-selected={session.active === row.key}
                          className={styles.word}
                          data-selected={session.active === row.key || undefined}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => session.accept(row)}
                        >
                          {row.text}
                        </div>
                        <Tooltip
                          content={t('search.removeHistory', { text: row.text ?? '' })}
                          relationship="label"
                        >
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<Dismiss16Regular />}
                            aria-label={t('search.removeHistory', { text: row.text ?? '' })}
                            onClick={() => {
                              search.recent.remove(row.text ?? '');
                              session.show('');
                            }}
                          />
                        </Tooltip>
                      </div>
                    ),
                  )}
                </div>
              );
            })}
          </div>
          <SearchFeedback results={search.preview} />
          {recent.failed && !session.draft && (
            <div role="status" className={styles.notice}>
              {t('search.historyFailed')}{' '}
              <Button size="small" onClick={() => void search.recent.retry()}>
                {t('album.retry')}
              </Button>
            </div>
          )}
          {(notice || playNotice) && (
            <div role="status" className={styles.notice}>
              {t(notice ?? playNotice ?? 'album.playFailed')}
            </div>
          )}
        </div>
        {!!session.draft.trim() && (
          <div className={styles.footer}>
            <Button
              appearance="subtle"
              icon={<ArrowRight16Regular />}
              onClick={() => session.submit()}
            >
              {t('search.viewAll')}
            </Button>
          </div>
        )}
      </div>
    </Portal>
  );
}
