import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import type { CSSProperties } from 'react';
import { albumArtistOf, type Album } from '../../host/libraryContract.ts';
import type { MessageKey } from '../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { historyKey } from '../../nav/navHistory.ts';
import { useService } from '../../kit/useService.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { SongArt } from '../SongArt.tsx';
import { useHomeServices } from './homeContext.ts';
import { feedLoading } from './homeFeed.ts';
import { HOME_RANK_COUNT } from './homeModel.ts';
import { HomeRankCard, RANK_CARD_SHAPE } from './HomeRankCard.tsx';
import { HomeRail } from './HomeRail.tsx';
import { HomeRow } from './HomeRow.tsx';
import { RankSkeleton, SkeletonRail } from './HomeSkeleton.tsx';
import styles from './HomeMostPlayed.module.css';

interface LocalEntry {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly cover: Album | undefined;
  readonly plays: number;
  readonly play: () => void;
  readonly menu?: (at: TablePoint) => void;
}

interface RankCard {
  readonly key: string;
  readonly name: string;
  readonly meta: string;
  readonly share: MessageKey;
  readonly round?: boolean;
  readonly entries: readonly LocalEntry[];
  readonly open: () => void;
}

/**
 * 最常播放：曲目、艺人、专辑各一张榜，按累计播放次数。点榜名或卡片空白处进对应的页面，点条目直接播放
 * 没有播放记录的榜不出，三张都没有时整行不出
 */
export function HomeMostPlayed({
  rowWidth,
  onAlbumMenu,
  onTrackMenu,
}: {
  readonly rowWidth: number;
  readonly onAlbumMenu: (album: Album, at: TablePoint, owner: string) => void;
  readonly onTrackMenu: (track: LibraryTrack, at: TablePoint) => void;
}) {
  const home = useHomeServices();
  const history = useService(historyKey);
  const albumDetail = useService(albumDetailKey);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const plural = useAtomValueRawSync(pluralAtom);
  const feed = useAtomValueRawSync(home.feed.state);
  const { mostPlayed } = feed.statistics;
  const busy = useAtomValueRawSync(home.busy);
  const number = new Intl.NumberFormat(locale);
  const albumCount = (value: number) =>
    t(plural(value, 'home.albumCountOne', 'home.albumCount'), { count: number.format(value) });
  const playCount = (value: number) =>
    t(plural(value, 'home.playsOne', 'home.plays'), { count: number.format(value) });
  const topTracks = mostPlayed.tracks.top.map(({ item }) => item);
  const cards: RankCard[] = [
    {
      key: 'tracks',
      name: t('home.tracks'),
      meta: t('home.rankTracksMeta', {
        tracks: number.format(mostPlayed.tracks.played),
        plays: number.format(mostPlayed.plays),
      }),
      share: 'home.topShareTracks',
      entries: mostPlayed.tracks.top.map(({ item, plays }, index) => ({
        key: item.handle,
        title: item.title || item.path,
        detail: (item.artists ?? []).join(t('album.nameSeparator')) || (item.artist ?? ''),
        cover: albumDetail.findAlbum(item) ?? undefined,
        plays,
        play: () => void home.playTop(topTracks, index),
        menu: (at) => onTrackMenu(item, at),
      })),
      open: () => home.openMostPlayed(),
    },
    {
      key: 'artists',
      name: t('place.artists'),
      meta: t('home.artistCount', { count: number.format(mostPlayed.artists.played) }),
      share: 'home.topShareArtists',
      round: true,
      entries: mostPlayed.artists.top.map(({ item, plays }) => ({
        key: item.name,
        title: item.name,
        detail: albumCount(item.albums),
        cover: item.cover ?? undefined,
        plays,
        play: () => void home.playArtist(item.name),
      })),
      open: () => home.openArtists(),
    },
    {
      key: 'albums',
      name: t('place.albums'),
      meta: albumCount(mostPlayed.albums.played),
      share: 'home.topShareAlbums',
      entries: mostPlayed.albums.top.map(({ item, plays }) => ({
        key: `${item.name}\n${albumArtistOf(item)}`,
        title: item.name,
        detail: albumArtistOf(item),
        cover: item,
        plays,
        play: () => void home.playAlbum(item),
        menu: (at) => onAlbumMenu(item, at, 'most-played'),
      })),
      open: () => history.navigate({ id: 'albums' }),
    },
  ];
  const shown = cards.filter((card) => card.entries.length > 0);
  const loading = feedLoading(feed) && !shown.length;
  if (!shown.length && !loading) return null;
  if (loading)
    return (
      <HomeRow section="most-played" title={t('home.mostPlayed')} loading>
        <SkeletonRail
          id="most-played"
          label={t('home.mostPlayed')}
          rowWidth={rowWidth}
          shape={RANK_CARD_SHAPE}
          items={RANK_CARD_SHAPE.per}
        >
          <RankSkeleton />
        </SkeletonRail>
      </HomeRow>
    );
  return (
    <HomeRow section="most-played" title={t('home.mostPlayed')}>
      <HomeRail
        id="most-played"
        label={t('home.mostPlayed')}
        rowWidth={rowWidth}
        shape={RANK_CARD_SHAPE}
        items={shown}
        keyOf={(card) => card.key}
        render={(card) => {
          const lead = card.entries[0];
          if (!lead) return null;
          const top = card.entries.reduce((sum, entry) => sum + entry.plays, 0);
          return (
            <HomeRankCard
              id={card.key}
              name={card.name}
              note={t('home.onThisDevice')}
              meta={card.meta}
              round={card.round}
              disabled={busy}
              onOpen={card.open}
              entries={card.entries.map((entry, index) => ({
                key: entry.key,
                title: entry.title,
                detail: entry.detail,
                art: (size) => <SongArt album={entry.cover} size={size} />,
                play: entry.play,
                menu: entry.menu,
                ...(index === 0
                  ? {
                      aside: <span className={styles.leadPlays}>{playCount(entry.plays)}</span>,
                      caption: t('home.rankFirst'),
                    }
                  : {
                      aside: (
                        <span className={styles.count}>
                          <span>{playCount(entry.plays)}</span>
                          <i
                            style={
                              {
                                '--share': `${Math.round((entry.plays / lead.plays) * 100)}%`,
                              } as CSSProperties
                            }
                          />
                        </span>
                      ),
                    }),
              }))}
              middle={
                <div className={styles.share}>
                  <div className={styles.bars} aria-hidden>
                    {card.entries.map((entry) => (
                      <i
                        key={entry.key}
                        style={{ height: `${Math.round((entry.plays / lead.plays) * 100)}%` }}
                      />
                    ))}
                  </div>
                  {card.entries.length === HOME_RANK_COUNT && mostPlayed.plays > 0 && (
                    <span className={styles.note}>
                      {t(card.share, { percent: Math.round((top / mostPlayed.plays) * 100) })}
                    </span>
                  )}
                </div>
              }
            />
          );
        }}
      />
    </HomeRow>
  );
}
