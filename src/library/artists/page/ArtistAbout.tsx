import { Link } from '@fluentui/react-components';
import {
  CalendarLtr16Regular,
  Clock16Regular,
  RecordRegular,
  TextNumberListLtr16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { Metadata, MetadataItem } from '../../../kit/Metadata.tsx';
import { BiographyPanel } from '../../biography/BiographyPanel.tsx';
import { useArtists } from '../artistsContext.ts';
import { matchSimilar } from '../artistTops.ts';
import { ArtistMissingAlbums } from './ArtistMissingAlbums.tsx';
import { ArtistPhotoGallery } from '../photos/ArtistPhotoGallery.tsx';
import styles from './ArtistAbout.module.css';

/** 「关于」里的本地事实：专辑、参与、曲目、时长与年份一行，常合作艺人一行；不联网，合辑也有 */
function ArtistFacts() {
  const services = useArtists();
  const name = useAtomValueRawSync(services.places.selected);
  const state = useAtomValueRawSync(services.detail.state);
  const compilation = useAtomValueRawSync(services.compilation);
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const detail = state.subject === name ? state.detail : null;
  if (!detail) return null;
  const summary = detail.summary;
  const count = new Intl.NumberFormat(locale);
  return (
    <div className={styles.facts} data-artist-facts>
      <Metadata>
        <MetadataItem icon={<RecordRegular />} label={t('trackInfo.album')}>
          {t(plural(summary.ownAlbums, 'album.countOne', 'album.count'), {
            count: count.format(summary.ownAlbums),
          })}
        </MetadataItem>
        {summary.guestAlbums > 0 && (
          <MetadataItem icon={<RecordRegular />}>
            {t(plural(summary.guestAlbums, 'artists.guestCountOne', 'artists.guestCount'), {
              count: count.format(summary.guestAlbums),
            })}
          </MetadataItem>
        )}
        <MetadataItem icon={<TextNumberListLtr16Regular />}>
          {t(plural(summary.tracks, 'album.menuTracksOne', 'album.menuTracks'), {
            count: count.format(summary.tracks),
          })}
        </MetadataItem>
        <MetadataItem icon={<Clock16Regular />} label={t('table.duration')}>
          {new Intl.NumberFormat(locale, {
            style: 'unit',
            unit: 'hour',
            maximumFractionDigits: 1,
          }).format(summary.duration / 3600)}
        </MetadataItem>
        {summary.firstYear && (
          <MetadataItem icon={<CalendarLtr16Regular />} label={t('table.year')}>
            {summary.firstYear}
            {summary.lastYear !== summary.firstYear ? `–${summary.lastYear}` : ''}
          </MetadataItem>
        )}
      </Metadata>
      {!compilation && !!detail.collaborators.length && (
        <p className={styles.collaborators}>
          {t('artists.collaborators')}{' '}
          {detail.collaborators.slice(0, 5).map((artist, at) => (
            <span key={artist.name}>
              {at > 0 && ' · '}
              <Link onClick={() => services.places.open(artist.name)}>{artist.name}</Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function ArtistAbout() {
  const { biography, compilation, catalog, places } = useArtists();
  const known = useAtomValueRawSync(catalog.all);
  const state = useAtomValueRawSync(biography.service.state);
  const images = useAtomValueRawSync(biography.artistImages.state);
  const links = useMemo(
    () =>
      new Map(
        matchSimilar(
          (state.details?.similar ?? []).map((item) => ({ ...item, match: 0 })),
          known.map((row) => row.name),
        ).flatMap((item) =>
          item.local
            ? [
                [
                  item.artist,
                  () => {
                    if (item.local) places.open(item.local);
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    [state.details, known, places],
  );
  const subject = useAtomValueRawSync(biography.subject);
  const language = useAtomValueRawSync(biography.language);
  const source = useAtomValueRawSync(biography.sourcePrefs.source);
  const combined = useAtomValueRawSync(compilation);
  const t = useAtomValueRawSync(translateAtom);
  // 合辑不联网，「关于」里只有本地统计，标题自己画
  if (combined || subject === null)
    return (
      <div className={styles.root} data-artist-about>
        <h2 className={styles.heading}>{t('artists.about')}</h2>
        <ArtistFacts />
      </div>
    );
  return (
    <div className={styles.root} data-artist-about>
      <BiographyPanel
        layout="about"
        heading={t('artists.about')}
        artist={subject}
        language={language}
        service={biography.service}
        identity={biography.identity}
        source={source}
        appleIdentity={biography.appleIdentity}
        sourcePrefs={biography.sourcePrefs}
        prefs={biography.prefs}
        artistLinks={links}
        artistImages={images}
        t={t}
        onRefresh={biography.refresh}
        onOpenSettings={biography.openSettings}
      />
      <ArtistFacts />
      <ArtistMissingAlbums key={`albums:${subject}`} />
      <ArtistPhotoGallery key={`photos:${subject}`} />
    </div>
  );
}
