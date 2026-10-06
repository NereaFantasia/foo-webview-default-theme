import { Link, Spinner, Tab, TabList, makeStyles } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState } from 'react';
import { useExternalLinks } from '../../../kit/external-link/ExternalLinkProvider.tsx';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { SongArt } from '../../songs/SongArt.tsx';
import { useArtists } from '../artistsContext.ts';
import { ArtistHighlightTable } from './ArtistHighlightTable.tsx';
import styles from './ArtistHighlights.module.css';

const useStyles = makeStyles({
  link: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
  },
});

export function ArtistHighlights() {
  const classes = useStyles();
  const services = useArtists();
  const detail = useAtomValueRawSync(services.detail.state);
  const online = useAtomValueRawSync(services.online.state);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const compilation = useAtomValueRawSync(services.compilation);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const links = useExternalLinks();
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  const played = detail.plays.status === 'ready' ? detail.plays.top : null;
  const popular = online.tracks;
  const mode = prefs.highlight === 'popular' && popular.length ? 'popular' : 'played';
  const rows = useMemo(
    () =>
      (mode === 'popular'
        ? popular.map((item) => ({
            rank: item.rank,
            title: item.title,
            track: item.local,
            plays: item.plays,
            url: item.url,
          }))
        : (played ?? []).map((item, at) => ({
            rank: at + 1,
            title: item.track.title,
            track: item.track,
            plays: item.plays,
            url: null,
          }))
      ).slice(0, 10),
    [mode, popular, played],
  );
  const local = useMemo(
    () =>
      rows.flatMap((row) =>
        row.track ? [{ rank: row.rank, track: row.track, plays: row.plays }] : [],
      ),
    [rows],
  );
  const external = rows.filter((row) => !row.track);
  const loading = detail.plays.status === 'loading' || detail.status === 'loading';
  if (compilation || (!rows.length && !popular.length && !loading)) return null;
  const format = (count: number) =>
    new Intl.NumberFormat(
      locale,
      count >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {},
    ).format(count);
  return (
    <section aria-label={t('artists.played')} className={styles.root}>
      <div className={styles.heading}>
        <TabList
          size="small"
          selectedValue={mode}
          onTabSelect={(_, data) =>
            services.prefs.update({ highlight: data.value === 'popular' ? 'popular' : 'played' })
          }
        >
          <Tab value="played">{t('artists.played')}</Tab>
          {!!popular.length && <Tab value="popular">{t('artists.popular')}</Tab>}
        </TabList>
      </div>
      <div ref={setScroll} className={styles.content} data-artist-highlights-scroll>
        {mode === 'played' && loading && <Spinner size="tiny" aria-label={t('artists.loading')} />}
        {mode === 'played' && !loading && !rows.length && <small>{t('artists.noPlays')}</small>}
        {mode === 'popular' && <small>{t('artists.lastfm')}</small>}
        {!!local.length && (
          <ArtistHighlightTable
            rows={local}
            scroll={scroll}
            label={t(mode === 'popular' ? 'artists.popular' : 'artists.played')}
          />
        )}
        {!!external.length && (
          <div className={styles.rows}>
            {external.map((row) => (
              <div key={row.url} className={styles.row} data-artist-external-track>
                <span className={styles.rank}>{row.rank}</span>
                <SongArt album={undefined} size={32} />
                <div className={styles.text}>
                  <Link
                    className={classes.link}
                    title={row.title}
                    onClick={() => {
                      if (row.url) links.open(row.url);
                    }}
                  >
                    <span className={styles.title}>{row.title}</span>
                    <Open16Regular aria-hidden className={styles['external-icon']} />
                  </Link>
                </div>
                <span className={styles.count}>
                  {t('artists.plays', { count: format(row.plays) })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
