import {
  Button,
  Input,
  Radio,
  RadioGroup,
  Spinner,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowLeft16Regular, Dismiss16Regular, Search16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { lyricsKey } from '../../../lyrics/lyricsService.ts';
import { isWordLevel } from '../../../lyrics/lyricsText.ts';
import styles from './LyricsSearch.module.css';

const useStyles = makeStyles({
  candidate: {
    width: '100%',
    alignItems: 'flex-start',
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
});

export function LyricsSearch({
  title: currentTitle,
  artist: currentArtist,
  enabled,
  onlineControl,
  onClose,
}: {
  readonly title: string;
  readonly artist: string;
  readonly enabled: boolean;
  readonly onlineControl: ReactNode;
  onClose(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(lyricsKey);
  const result = useAtomValueRawSync(service.choices);
  const [keywords, setKeywords] = useState([currentTitle, currentArtist].filter(Boolean).join(' '));
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const classes = useStyles();
  const busy = result.status === 'searching' || result.status === 'loading';
  const chosen = result.candidates.find(
    (candidate) => `${candidate.source}:${candidate.ref}` === selected,
  );
  useEffect(() => {
    service.cancelSearch();
    if (enabled && !composing && keywords.trim())
      timer.current = setTimeout(() => void service.search(keywords), 400);
    return () => {
      clearTimeout(timer.current);
      service.cancelSearch();
    };
  }, [service, enabled, composing, keywords]);
  return (
    <section className={styles.root} aria-label={t('lyrics.search')} data-lyrics-search>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!enabled || composing || !keywords.trim()) return;
          clearTimeout(timer.current);
          setSelected('');
          void service.search(keywords);
        }}
      >
        <div className={styles.heading}>
          <Tooltip content={t('lyrics.back')} relationship="label">
            <Button appearance="subtle" icon={<ArrowLeft16Regular />} onClick={onClose} />
          </Tooltip>
          <strong>{t('lyrics.search')}</strong>
        </div>
        <Input
          ref={input}
          autoFocus
          aria-label={t('lyrics.keywords')}
          placeholder={t('lyrics.keywords')}
          value={keywords}
          onChange={(_, data) => {
            service.cancelSearch();
            setSelected('');
            setKeywords(data.value);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          contentBefore={<Search16Regular />}
          contentAfter={
            keywords && (
              <Tooltip content={t('lyrics.clearSearch')} relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Dismiss16Regular />}
                  onClick={() => {
                    input.current?.focus();
                    setSelected('');
                    setKeywords('');
                  }}
                />
              </Tooltip>
            )
          }
        />
        {!enabled && <div onChangeCapture={() => input.current?.focus()}>{onlineControl}</div>}
      </form>
      <div className={styles.results}>
        {result.status === 'searching' && <Spinner size="small" label={t('lyrics.searching')} />}
        {(result.status === 'search-failed' || result.failed.length > 0) && (
          <p role="status">
            {t(result.candidates.length > 0 ? 'lyrics.searchPartial' : 'lyrics.searchFailed')}
          </p>
        )}
        {result.status === 'fetch-failed' && <p role="status">{t('lyrics.fetchFailed')}</p>}
        {result.status === 'missing' && <p role="status">{t('lyrics.selectedMissing')}</p>}
        {result.status === 'ready' &&
          result.failed.length === 0 &&
          result.candidates.length === 0 && <p role="status">{t('lyrics.onlineMissing')}</p>}
        <RadioGroup
          aria-label={t('lyrics.search')}
          value={selected}
          onChange={(_, data) => setSelected(data.value)}
        >
          {result.candidates.map((candidate) => {
            const id = `${candidate.source}:${candidate.ref}`;
            const kind = !candidate.content
              ? 'unknownFormat'
              : isWordLevel(candidate.content)
                ? 'word'
                : candidate.content.kind === 'synced'
                  ? 'line'
                  : 'plain';
            return (
              <Radio
                key={id}
                value={id}
                className={classes.candidate}
                disabled={busy}
                label={
                  <span className={styles.candidate}>
                    <strong>{candidate.title}</strong>
                    <span>
                      {[candidate.artists.join(', '), candidate.album].filter(Boolean).join(' / ')}
                    </span>
                    <span>
                      {t(`lyrics.source.${candidate.source}`)} / {t(`lyrics.${kind}`)}
                    </span>
                  </span>
                }
              />
            );
          })}
        </RadioGroup>
      </div>
      <div className={styles.actions}>
        <span role="status">{t('lyrics.results', { count: result.candidates.length })}</span>
        <Button
          disabled={!enabled || !chosen || busy}
          onClick={() => {
            if (chosen)
              void service.choose(chosen).then((used) => {
                if (used) onClose();
              });
          }}
        >
          {result.status === 'loading' ? t('lyrics.loading') : t('lyrics.use')}
        </Button>
      </div>
    </section>
  );
}
