import { useAtomValueRawSync } from 'jotai/react';
import { atom, type Atom } from 'jotai/vanilla';
import { useContext, useMemo } from 'react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { sidebarViewAtom } from '../nav/sidebar/sidebarView.ts';
import { playerBarStyleAtom, playerShellOf } from '../theme/playerBarStyle.ts';
import { ArtistsContext } from '../library/artists/artistsContext.ts';
import type { ArtistRow } from '../library/artists/artistIndex.ts';
import { matchSimilar } from '../library/artists/artistTops.ts';
import { BiographyArtistSwitch } from '../library/biography/BiographyArtistSwitch.tsx';
import { BiographyPanel } from '../library/biography/BiographyPanel.tsx';
import { BiographyPhotos } from '../library/biography/BiographyPhotos.tsx';
import { BiographyLibraryInfo } from '../library/biography/local/BiographyLibraryInfo.tsx';
import type { BiographyIntegration } from './biographyIntegration.ts';

const NO_ARTISTS: Atom<readonly ArtistRow[]> = atom([]);

/** 右侧卡的「简介」页：正在播放那首歌的艺人，多位时可切换 */
export function BiographyContent({ integration }: { readonly integration: BiographyIntegration }) {
  const input = useAtomValueRawSync(integration.input);
  const language = useAtomValueRawSync(integration.language);
  const artistImages = useAtomValueRawSync(integration.artistImages.state);
  const source = useAtomValueRawSync(integration.sourcePrefs.source);
  const artists = useAtomValueRawSync(integration.artists);
  const selected = useAtomValueRawSync(integration.artist);
  const searching = useAtomValueRawSync(integration.searching);
  const details = useAtomValueRawSync(integration.service.state).details;
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const { tier } = useAtomValueRawSync(sidebarViewAtom);
  const shell = playerShellOf(useAtomValueRawSync(playerBarStyleAtom), tier === 'wide');
  // 艺人页的服务随艺人页的装配晚一拍就位；没就位时名字照常显示，只是不能点
  const artistServices = useContext(ArtistsContext);
  const places = artistServices?.places;
  const known = useAtomValueRawSync(artistServices?.catalog.all ?? NO_ARTISTS);
  const artistLinks = useMemo(
    () =>
      new Map(
        places
          ? matchSimilar(
              (details?.similar ?? []).map((item) => ({ ...item, match: 0 })),
              known.map((row) => row.name),
            ).flatMap((item) => {
              const local = item.local;
              return local ? [[item.artist, () => places.open(local)] as const] : [];
            })
          : [],
      ),
    [details, known, places],
  );
  return (
    <BiographyPanel
      artist={input?.artist ?? null}
      language={language}
      service={integration.service}
      identity={integration.identity}
      source={source}
      appleIdentity={integration.appleIdentity}
      sourcePrefs={integration.sourcePrefs}
      prefs={integration.prefs}
      t={t}
      top={
        <BiographyArtistSwitch
          artists={artists}
          selected={selected}
          onSelect={integration.select}
          t={t}
        />
      }
      summary={<BiographyLibraryInfo service={integration.local} locale={locale} t={t} />}
      related={
        <BiographyLibraryInfo
          service={integration.local}
          locale={locale}
          t={t}
          collaborators
          {...(places ? { onOpenArtist: (name: string) => places.open(name) } : {})}
        />
      }
      onOpenSettings={integration.openSettings}
      artistImages={artistImages}
      artistLinks={artistLinks}
      onRefresh={integration.refresh}
      photos={
        <BiographyPhotos
          service={integration.photos}
          t={t}
          top={shell.inTitlebar ? 56 : 48}
          searching={searching}
          onRetry={integration.refreshPhotos}
        />
      }
    />
  );
}
