import { Link } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom } from '../../../i18n/locale.ts';
import type { BiographyTranslate } from '../BiographyPanel.tsx';
import type { BiographyDetails as Details, BiographyFact } from './biographyDetailsModel.ts';
import styles from './BiographyDetails.module.css';

function BiographySimilarImage({ url }: { readonly url: string | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      className={styles.portrait}
      src={url}
      alt=""
      width={20}
      height={20}
      onError={() => setFailed(true)}
    />
  );
}

export function BiographyDetails({
  facts = [],
  details,
  t,
  onOpen,
  artistImages,
  artistLinks,
}: {
  readonly facts?: readonly BiographyFact[];
  readonly details: Details | null | undefined;
  readonly t: BiographyTranslate;
  readonly onOpen: (url: string) => void;
  readonly artistImages?: ReadonlyMap<string, string>;
  readonly artistLinks?: ReadonlyMap<string, () => void>;
}) {
  const counters = details?.counters ?? [];
  const locale = useAtomValueRawSync(localeAtom).active;
  const similar = details?.similar ?? [];
  if (!facts.length && !counters.length && !similar.length && !details?.tags.length) return null;
  const format = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const exact = new Intl.NumberFormat(locale);
  return (
    <div className={styles.root} data-biography-details lang={details?.language}>
      {(facts.length > 0 || counters.length > 0) && (
        <section aria-label={t('biography.facts')}>
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.kind ? t(`biography.${fact.kind}`) : fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
            {counters.map((counter) => (
              <div key={counter.label}>
                <dt>
                  {counter.kind ? `Last.fm ${t(`biography.${counter.kind}`)}` : counter.label}
                </dt>
                <dd title={exact.format(counter.value)}>
                  {(counter.value < 10_000 ? exact : format).format(counter.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!!details?.tags.length && (
        <div className={styles.tags}>
          <span>{t('biography.tags')}</span>
          <span>{details.tags.join(' · ')}</span>
        </div>
      )}
      {similar.length > 0 && (
        <section aria-label={t('biography.similar')}>
          <h3>{t('biography.similar')}</h3>
          <ul className={styles.similar}>
            {similar.map((item) => (
              <li key={item.url}>
                <Link
                  onClick={() => {
                    const open = artistLinks?.get(item.artist);
                    if (open) open();
                    else onOpen(item.url);
                  }}
                  aria-label={
                    artistLinks?.has(item.artist) ? item.artist : `${item.artist} · Last.fm`
                  }
                >
                  <BiographySimilarImage
                    key={artistImages?.get(item.artist)}
                    url={artistImages?.get(item.artist)}
                  />
                  {item.artist} {!artistLinks?.has(item.artist) && <Open16Regular aria-hidden />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
