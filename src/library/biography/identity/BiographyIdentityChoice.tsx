import { Button, makeStyles, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { lastfmArtistUrl } from '../biographyModel.ts';
import type { BiographyPrefsService } from '../biographyPrefs.ts';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { BiographyIdentityService } from './biographyIdentity.ts';
import type { MusicbrainzCandidate } from './musicbrainzArtist.ts';
import styles from './BiographyIdentityChoice.module.css';

const useStyles = makeStyles({
  candidate: {
    justifyContent: 'flex-start',
    width: '100%',
    textAlign: 'start',
    fontWeight: 'inherit',
  },
});

function years({ begin, end }: MusicbrainzCandidate): string {
  const from = begin.slice(0, 4);
  const to = end.slice(0, 4);
  return from || to ? `${from}–${to}` : '';
}

/** 同名候选里帮用户辨认的一行：消歧说明、国家、起止年份，有哪项写哪项。 */
function describe(candidate: MusicbrainzCandidate): string {
  return [candidate.disambiguation, candidate.country, years(candidate)]
    .filter(Boolean)
    .join(' · ');
}

export interface BiographyIdentityChoiceProps {
  readonly artist: string;
  readonly identity: BiographyIdentityService;
  readonly prefs: BiographyPrefsService;
  readonly t: BiographyTranslate;
}

/**
 * 没认定身份时简介里显示的那一块：正在认定、同名候选、查无此人或认定失败。选中一位后存成手选，
 * 之后取简介按他在 Last.fm 上的名字。粘贴链接确认的表单仍在面板里，排在这一块下面。
 */
export function BiographyIdentityChoice({
  artist,
  identity,
  prefs,
  t,
}: BiographyIdentityChoiceProps) {
  const classes = useStyles();
  const state = useAtomValueRawSync(identity.state);
  const settings = useAtomValueRawSync(prefs.state);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (state.artist !== artist) return null;
  const pick = async (mbid: string) => {
    setBusy(mbid);
    setFailed(null);
    const picked = await identity.pick(mbid);
    setBusy(null);
    if (!picked) return setFailed(mbid);
    prefs.confirm(artist, lastfmArtistUrl(picked.sourceArtist, 'en'), picked.mbid);
  };
  if (state.status === 'resolving')
    return <Spinner size="tiny" aria-label={t('biography.identityResolving')} />;
  if (state.status === 'none') return <p className={styles.note}>{t('biography.identityNone')}</p>;
  if (state.status === 'failed')
    return (
      <div className={styles.note}>
        <span>
          {t('biography.identityFailed')} · {t(`biography.${state.problem}`)}
        </span>
        <Button size="small" onClick={() => identity.refresh()}>
          {t('biography.retry')}
        </Button>
      </div>
    );
  if (state.status !== 'ambiguous') return null;
  return (
    <section className={styles.root} aria-label={t('biography.identityCandidates')}>
      <h3 className={styles.heading}>{t('biography.identityCandidates')}</h3>
      <ul className={styles.list}>
        {state.candidates.map((candidate) => (
          <li key={candidate.mbid}>
            <Button
              appearance="subtle"
              className={classes.candidate}
              disabled={!!busy || !settings.loaded || settings.busy}
              icon={busy === candidate.mbid ? <Spinner size="extra-tiny" /> : undefined}
              onClick={() => void pick(candidate.mbid)}
            >
              <span className={styles.candidate}>
                <span className={styles.name}>{candidate.name}</span>
                {describe(candidate) && <span className={styles.meta}>{describe(candidate)}</span>}
              </span>
            </Button>
            {failed === candidate.mbid && (
              <span className={styles.meta} role="status">
                {t('biography.identityPickFailed')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
