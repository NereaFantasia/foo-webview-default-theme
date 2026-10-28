import { Button, Spinner } from '@fluentui/react-components';
import { RecordRegular, TextNumberListLtr16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import type { MessageKey } from '../../../i18n/en.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { Metadata, MetadataItem } from '../../../kit/Metadata.tsx';
import type { MusicSearchKind } from '../../../server/musicProtocol.ts';
import type {
  MusicAlbum,
  MusicArtist,
  MusicPlaylist,
  MusicTrack,
} from '../../../server/musicObjects.ts';
import { TrackMetadata } from '../../../track/TrackMetadata.tsx';
import { searchNameRank } from '../searchQuery.ts';
import { artistNames, OnlineBestRow } from './OnlineItems.tsx';
import {
  OnlineAlbumTile,
  OnlineArtistTile,
  OnlinePlaylistTile,
  ONLINE_ARTIST_SHAPE,
  refKey,
  type OnlineTileActions,
} from './OnlineTiles.tsx';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../../cover-tile/CoverGrid.tsx';
import type { OnlineCategory } from './onlineSearch.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import styles from './OnlineOverview.module.css';

export const ONLINE_CATEGORY_LABELS = {
  all: 'search.all',
  artists: 'search.artists',
  albums: 'search.albums',
  tracks: 'search.tracks',
  playlists: 'online.playlists',
} as const satisfies Record<OnlineCategory, MessageKey>;

/** 各类结果的名称，与分类页签同一套写法 */
export const ONLINE_KIND_LABELS = {
  artist: 'search.artists',
  album: 'search.albums',
  track: 'search.tracks',
  playlist: 'online.playlists',
} as const satisfies Record<MusicSearchKind, MessageKey>;

/** 曲目节最多列几项，照本地结果页 */
const TRACK_PREVIEW = 5;

/** 图块与头像只画一行，放不下的不换行，从节头的「查看全部」进分类页看 */
const GRID_PREVIEW_ROWS = 1;

type Best =
  | { readonly kind: 'artist'; readonly item: MusicArtist }
  | { readonly kind: 'album'; readonly item: MusicAlbum }
  | { readonly kind: 'track'; readonly item: MusicTrack };

/** 照本地结果页的规则：艺人、专辑、曲目各取排在最前的一个，名字最贴近的胜出，同档依次优先艺人、专辑 */
function bestOf(
  text: string,
  artists: readonly MusicArtist[],
  albums: readonly MusicAlbum[],
  tracks: readonly MusicTrack[],
): Best | null {
  const candidates: [Best, string][] = [];
  if (artists[0]) candidates.push([{ kind: 'artist', item: artists[0] }, artists[0].name]);
  if (albums[0]) candidates.push([{ kind: 'album', item: albums[0] }, albums[0].title]);
  if (tracks[0]) candidates.push([{ kind: 'track', item: tracks[0] }, tracks[0].title]);
  let best: Best | null = null;
  let rank = Infinity;
  for (const [candidate, name] of candidates) {
    const next = searchNameRank(name, text);
    if (next < rank) [best, rank] = [candidate, next];
  }
  return best;
}

export interface OnlineOverviewProps {
  readonly text: string;
  readonly artists: readonly MusicArtist[];
  readonly albums: readonly MusicAlbum[];
  readonly tracks: readonly MusicTrack[];
  readonly playlists: readonly MusicPlaylist[];
  /** 还在取第一页的类别：那一节只写节头与忙碌状态；艺人、专辑、曲目都取到之前不出最佳匹配，免得它中途换人 */
  readonly pending: readonly MusicSearchKind[];
  /** 节头的「查看全部」切到那一类 */
  onChoose(category: Exclude<OnlineCategory, 'all'>): void;
  onPlay(track: MusicTrack): void;
  /** 专辑、艺人、歌单的单击与右键，最佳匹配里的艺人与专辑同样 */
  tileActions(item: MusicAlbum | MusicArtist | MusicPlaylist): OnlineTileActions;
  /** 曲目节的表由结果页画，与「曲目」分类同一套行、选区与菜单 */
  renderTracks(tracks: readonly MusicTrack[]): ReactNode;
}

/** 「全部」：最佳匹配，再依次是艺人、专辑、曲目、歌单各一节；排进最佳匹配的那一项不在下面重复 */
export function OnlineOverview({
  text,
  artists,
  albums,
  tracks,
  playlists,
  pending,
  onChoose,
  onPlay,
  tileActions,
  renderTracks,
}: OnlineOverviewProps) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const plural = useAtomValueRawSync(pluralAtom);
  const settled = pending.every((kind) => kind === 'playlist');
  const best = settled ? bestOf(text, artists, albums, tracks) : null;
  const preview = <T extends { readonly ref: { readonly id: string } }>(
    items: readonly T[],
    kind: MusicSearchKind,
  ) => items.filter((item) => !(best?.kind === kind && best.item.ref.id === item.ref.id));
  const section = (
    target: Exclude<OnlineCategory, 'all'>,
    kind: MusicSearchKind,
    items: readonly unknown[],
    body: ReactNode,
  ) => {
    const busy = items.length === 0 && pending.includes(kind);
    if (items.length === 0 && !busy) return null;
    return (
      <section aria-busy={busy || undefined}>
        <div className={styles.group}>
          <h2>{t(ONLINE_CATEGORY_LABELS[target])}</h2>
          {!busy && (
            <Button
              className={viewControls.icon}
              appearance="subtle"
              size="small"
              onClick={() => onChoose(target)}
            >
              {t('search.viewAll')}
            </Button>
          )}
        </div>
        {busy ? <Spinner className={styles.busy} size="tiny" /> : body}
      </section>
    );
  };
  const shownArtists = preview(artists, 'artist');
  const shownAlbums = preview(albums, 'album');
  const shownTracks = preview(tracks, 'track').slice(0, TRACK_PREVIEW);
  const shownPlaylists = preview(playlists, 'playlist');
  return (
    <div className={styles.root}>
      {best && (
        <section>
          <h2>{t('search.best')}</h2>
          {best.kind === 'artist' ? (
            <OnlineBestRow
              cover={best.item.avatar}
              round
              title={best.item.name}
              onActivate={tileActions(best.item).onOpen}
              onMenu={tileActions(best.item).onMenu}
            >
              <span>{t('search.artists')}</span>
              <Metadata>
                {best.item.albumCount !== null && (
                  <MetadataItem icon={<RecordRegular />}>
                    {t(plural(best.item.albumCount, 'album.countOne', 'album.count'), {
                      count: best.item.albumCount,
                    })}
                  </MetadataItem>
                )}
                {best.item.trackCount !== null && (
                  <MetadataItem icon={<TextNumberListLtr16Regular />}>
                    {t(plural(best.item.trackCount, 'album.menuTracksOne', 'album.menuTracks'), {
                      count: best.item.trackCount,
                    })}
                  </MetadataItem>
                )}
              </Metadata>
            </OnlineBestRow>
          ) : best.kind === 'album' ? (
            <OnlineBestRow
              cover={best.item.artwork}
              round={false}
              title={best.item.title}
              onActivate={tileActions(best.item).onOpen}
              onMenu={tileActions(best.item).onMenu}
            >
              <span>{t('search.albums')}</span>
              <TrackMetadata artist={artistNames(best.item)} album="" />
            </OnlineBestRow>
          ) : (
            <OnlineBestRow
              cover={best.item.artwork}
              round={false}
              title={best.item.title}
              onActivate={() => onPlay(best.item)}
            >
              <span>{t('search.tracks')}</span>
              <TrackMetadata artist={artistNames(best.item)} album={best.item.album?.title ?? ''} />
            </OnlineBestRow>
          )}
        </section>
      )}
      {section(
        'artists',
        'artist',
        shownArtists,
        <CoverGrid
          shape={ONLINE_ARTIST_SHAPE}
          keyOf={refKey}
          previewRows={GRID_PREVIEW_ROWS}
          items={shownArtists}
          render={(artist) => <OnlineArtistTile artist={artist} {...tileActions(artist)} />}
        />,
      )}
      {section(
        'albums',
        'album',
        shownAlbums,
        <CoverGrid
          shape={STANDARD_GRID_SHAPE}
          keyOf={refKey}
          previewRows={GRID_PREVIEW_ROWS}
          items={shownAlbums}
          render={(album) => <OnlineAlbumTile album={album} {...tileActions(album)} />}
        />,
      )}
      {section('tracks', 'track', shownTracks, renderTracks(shownTracks))}
      {section(
        'playlists',
        'playlist',
        shownPlaylists,
        <CoverGrid
          shape={STANDARD_GRID_SHAPE}
          keyOf={refKey}
          previewRows={GRID_PREVIEW_ROWS}
          items={shownPlaylists}
          render={(playlist) => (
            <OnlinePlaylistTile playlist={playlist} {...tileActions(playlist)} />
          )}
        />,
      )}
    </div>
  );
}
