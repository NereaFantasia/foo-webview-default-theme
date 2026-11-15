import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { platformName } from '../../playback/musicPlatforms.ts';
import type { MusicAlbum, MusicPlaylist } from '../../server/musicObjects.ts';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { OnlineAlbumTile, OnlinePlaylistTile, refKey } from '../search/online/OnlineTiles.tsx';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import { useHomeServices } from './homeContext.ts';
import { HOME_ALBUM_AREAS } from './homeOnline.ts';
import { HomeRail, TILE_SHAPE, TILE_VARS } from './HomeRail.tsx';
import { HomeAreaMenu, HomeRow } from './HomeRow.tsx';
import { SkeletonRail, TileSkeleton } from './HomeSkeleton.tsx';

/** 推荐歌单：平台的公共推荐，副标题写播放量。点图块进歌单页，悬停起播；没有歌单时整行不出 */
export function HomePlaylists({ rowWidth }: { readonly rowWidth: number }) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const home = useHomeServices();
  const available = useAtomValueRawSync(home.online.available);
  const read = useAtomValueRawSync(home.online.playlists);
  const { tileActions, menu, closeMenu } = useOnlineTileActions(home.notify);
  if (!available || read.status === 'failed' || (read.status === 'ready' && !read.items.length))
    return null;
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const title = t('home.playlists');
  const detailOf = (playlist: MusicPlaylist) =>
    playlist.playCount === null
      ? undefined
      : t('home.onlinePlays', { plays: compact.format(playlist.playCount) });
  return (
    <HomeRow
      section="playlists"
      title={title}
      source={platformName(t, 'wy')}
      loading={read.status === 'loading'}
    >
      {read.status === 'loading' ? (
        <SkeletonRail
          id="playlists"
          label={title}
          rowWidth={rowWidth}
          shape={TILE_SHAPE}
          items={TILE_SHAPE.per + 1}
        >
          <TileSkeleton />
        </SkeletonRail>
      ) : (
        <HomeRail
          id="playlists"
          label={title}
          rowWidth={rowWidth}
          shape={TILE_SHAPE}
          items={read.items}
          keyOf={refKey}
          render={(playlist) => (
            <div style={TILE_VARS}>
              <OnlinePlaylistTile
                playlist={playlist}
                detail={detailOf(playlist)}
                {...tileActions(playlist)}
              />
            </div>
          )}
        />
      )}
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={home.notify} />
    </HomeRow>
  );
}

/** 发行日期写成「11月8日」这样，年份不写：这一行都是近一两周发行的 */
function releaseDay(date: string | null, locale: string): string | null {
  const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(day);
}

/**
 * 最新发布：平台按地区给的新碟，副标题先写发行日期再写艺人。点图块进专辑页，悬停起播；标题后可换地区，
 * 没有专辑时整行不出
 */
export function HomeReleases({ rowWidth }: { readonly rowWidth: number }) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const home = useHomeServices();
  const available = useAtomValueRawSync(home.online.available);
  const read = useAtomValueRawSync(home.online.newAlbums);
  const area = useAtomValueRawSync(home.online.albumArea);
  const { tileActions, menu, closeMenu } = useOnlineTileActions(home.notify);
  if (!available || read.status === 'failed' || (read.status === 'ready' && !read.items.length))
    return null;
  const title = t('home.releases');
  const detailOf = (album: MusicAlbum) => {
    const artists = album.artists.map((artist) => artist.name).join(t('album.nameSeparator'));
    const day = releaseDay(album.releaseDate, locale);
    return day ? t('home.releaseDetail', { date: day, artists }) : artists;
  };
  return (
    <HomeRow
      section="releases"
      title={title}
      source={platformName(t, 'wy')}
      loading={read.status === 'loading'}
      extra={
        <HomeAreaMenu
          label={t('home.releasesArea')}
          areas={HOME_ALBUM_AREAS}
          value={area}
          onChange={home.online.setAlbumArea}
        />
      }
    >
      {read.status === 'loading' ? (
        <SkeletonRail
          id="releases"
          label={title}
          rowWidth={rowWidth}
          shape={TILE_SHAPE}
          items={TILE_SHAPE.per + 1}
        >
          <TileSkeleton />
        </SkeletonRail>
      ) : (
        <HomeRail
          id="releases"
          label={title}
          rowWidth={rowWidth}
          shape={TILE_SHAPE}
          items={read.items}
          keyOf={refKey}
          render={(album) => (
            <div style={TILE_VARS}>
              <OnlineAlbumTile album={album} detail={detailOf(album)} {...tileActions(album)} />
            </div>
          )}
        />
      )}
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={home.notify} />
    </HomeRow>
  );
}
