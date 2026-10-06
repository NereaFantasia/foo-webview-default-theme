import { Link } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useExternalLinks } from '../../../kit/external-link/ExternalLinkProvider.tsx';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useArtists } from '../artistsContext.ts';
import styles from './ArtistMissingAlbums.module.css';

export function ArtistMissingAlbums() {
  const services = useArtists();
  const online = useAtomValueRawSync(services.online.state);
  const detail = useAtomValueRawSync(services.detail.state);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const links = useExternalLinks();
  if (
    detail.status !== 'ready' ||
    detail.partial ||
    detail.guestPending ||
    !online.missingAlbums.length
  )
    return null;
  return (
    <section className={styles.root} aria-label={t('artists.missingAlbums')}>
      <h3>{t('artists.missingAlbums')}</h3>
      <ul>
        {online.missingAlbums.map((album) => (
          <li key={album.url}>
            <Link
              onClick={() => {
                links.open(album.url);
              }}
            >
              {album.title} <Open16Regular />
            </Link>
            <span>
              {t('artists.plays', {
                count: new Intl.NumberFormat(
                  locale,
                  album.plays >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {},
                ).format(album.plays),
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
