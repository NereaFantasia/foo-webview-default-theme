import { Spinner, Tab, TabList } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useArtists } from '../artistsContext.ts';
import { newestFirst } from '../albumOrder.ts';
import { ArtistTopTracks, type ArtistTopRow } from './ArtistTopTracks.tsx';
import styles from './ArtistHighlights.module.css';

/** 常听与热门：页签切换，最多 12 首（三栏时全露，两栏露前 10 首）；没有播放记录时改列他自己的曲目 */
export function ArtistHighlights() {
  const services = useArtists();
  const detail = useAtomValueRawSync(services.detail.state);
  const online = useAtomValueRawSync(services.online.state);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const compilation = useAtomValueRawSync(services.compilation);
  const t = useAtomValueRawSync(translateAtom);
  const played = detail.plays.status === 'ready' ? detail.plays.top : null;
  const popular = online.tracks;
  const mode = prefs.highlight === 'popular' && popular.length ? 'popular' : 'played';
  const rows = useMemo<readonly ArtistTopRow[]>(
    () =>
      (mode === 'popular'
        ? popular.map((item) => ({
            title: item.title,
            track: item.local,
            url: item.url,
            plays: item.plays,
          }))
        : (played ?? []).map((item) => ({
            title: item.track.title,
            track: item.track,
            url: null,
            plays: item.plays,
          }))
      ).slice(0, 12),
    [mode, popular, played],
  );
  const loading = detail.plays.status === 'loading' || detail.status === 'loading';
  // 没有播放记录（新导入的库）时改列他自己的曲目，按专辑新的在前，不出空块
  const fallback = useMemo<readonly ArtistTopRow[]>(
    () =>
      newestFirst(detail.detail?.own ?? [], (group) => group.album)
        .flatMap((group) => group.tracks)
        .slice(0, 12)
        .map((track) => ({ title: track.title, track, url: null, plays: null })),
    [detail.detail],
  );
  const unplayed = mode === 'played' && !loading && !rows.length;
  const listed = unplayed ? fallback : rows;
  if (compilation || (!rows.length && !popular.length && !loading && !fallback.length)) return null;
  const label = t(
    mode === 'popular' ? 'artists.popular' : unplayed ? 'artists.localTracks' : 'artists.played',
  );
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
          <Tab value="played">{t(unplayed ? 'artists.localTracks' : 'artists.played')}</Tab>
          {!!popular.length && <Tab value="popular">{t('artists.popular')}</Tab>}
        </TabList>
      </div>
      <div className={styles.content} data-artist-highlights-scroll>
        {mode === 'played' && loading && <Spinner size="tiny" aria-label={t('artists.loading')} />}
        {mode === 'popular' && <small>{t('artists.lastfm')}</small>}
        {!!listed.length && <ArtistTopTracks rows={listed} label={label} />}
      </div>
    </section>
  );
}
