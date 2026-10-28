import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { Button, Input } from '@fluentui/react-components';
import { Dismiss16Regular, Search16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { LyricsCandidateResults } from '../../../lyrics/candidates/LyricsCandidateResults.tsx';
import { lyricsKey } from '../../../lyrics/lyricsService.ts';
import type { LyricsCandidate } from '../../../lyrics/online/lyricsSource.ts';
import { useLyricsSearchQuery } from '../../../lyrics/useLyricsSearchQuery.ts';
import { createSnapshotSlot } from '../../../nav/historyStack.ts';
import { useRightCardSnapshot } from '../rightCardContext.ts';
import { LyricsSubpageHeading } from './LyricsSubpageHeading.tsx';
import styles from './LyricsSearch.module.css';

const SNAPSHOT = createSnapshotSlot<{ keywords: string; scroll: number; focus: string }>();

export function LyricsSearch({
  title,
  artist,
  enabled,
  onlineControl,
  onUsed,
  onPreview,
}: {
  readonly title: string;
  readonly artist: string;
  readonly enabled: boolean;
  readonly onlineControl: ReactNode;
  onUsed(): void;
  onPreview(candidate: LyricsCandidate): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const service = useService(lyricsKey);
  const query = useLyricsSearchQuery({
    enabled,
    fallbackKeywords: [title, artist].filter(Boolean).join(' '),
    onUsed,
  });
  const { result, keywords, setKeywords, using } = query;
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const pendingSnapshot = useRef<{ keywords: string; scroll: number; focus: string } | null>(null);
  useRightCardSnapshot(SNAPSHOT, {
    capture: () => ({
      keywords,
      scroll: results.current?.scrollTop ?? 0,
      focus:
        document.activeElement instanceof HTMLElement
          ? (document.activeElement.dataset.lyricsFocus ?? '')
          : '',
    }),
    restore: (value) => {
      pendingSnapshot.current = value;
      setKeywords(value.keywords);
      void service.search(value.keywords);
    },
  });
  useLayoutEffect(() => {
    const pending = pendingSnapshot.current;
    if (
      !pending ||
      result.keywords.trim() !== pending.keywords.trim() ||
      keywords !== pending.keywords ||
      (pending.keywords.trim() && result.status !== 'ready')
    )
      return;
    if (results.current) results.current.scrollTop = pending.scroll;
    const focused = [
      ...(root.current?.querySelectorAll<HTMLElement>('[data-lyrics-focus]') ?? []),
    ].find((element) => element.dataset.lyricsFocus === pending.focus);
    focused?.focus({ preventScroll: true });
    pendingSnapshot.current = null;
  }, [result, keywords]);
  return (
    <section ref={root} className={styles.root} aria-label={t('lyrics.search')} data-lyrics-search>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          query.submit();
        }}
      >
        <LyricsSubpageHeading title={t('lyrics.search')} />
        <Input
          className={controls.field}
          ref={input}
          autoFocus
          data-lyrics-focus="query"
          aria-label={t('lyrics.keywords')}
          placeholder={t('lyrics.keywords')}
          value={keywords}
          onChange={(_, data) => query.change(data.value)}
          onCompositionStart={() => query.setComposing(true)}
          onCompositionEnd={() => query.setComposing(false)}
          contentBefore={<Search16Regular />}
          contentAfter={
            keywords && (
              <Button
                appearance="subtle"
                size="small"
                className={controls.icon}
                icon={<Dismiss16Regular />}
                aria-label={t('lyrics.clearSearch')}
                onClick={() => {
                  input.current?.focus();
                  query.clear();
                }}
              />
            )
          }
        />
        {!enabled && <div onChangeCapture={() => input.current?.focus()}>{onlineControl}</div>}
      </form>
      <div ref={results} className={styles.results}>
        <LyricsCandidateResults
          result={result}
          enabled={enabled}
          viewport={results}
          using={using}
          onPreview={onPreview}
          onUse={query.use}
        />
      </div>
    </section>
  );
}
