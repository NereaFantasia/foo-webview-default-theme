import { Person48Regular, Record48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { CoverTheme } from '../../../covers/CoverTheme.tsx';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { onlineCoverUrl } from '../../../playback/onlineTracks.ts';
import type { MusicAlbum, MusicArtist, MusicPlaylist } from '../../../server/musicObjects.ts';
import {
  ARTIST_TILE_SIZE,
  ObjectTile,
  type ObjectTileActions,
} from '../../cover-tile/ObjectTile.tsx';
import { TileArt } from '../../cover-tile/TileArt.tsx';
import { STANDARD_TILE_SIZE } from '../../cover-tile/tileGeometry.ts';
import { LinkedArtists } from '../../../track/TrackCredits.tsx';
import { musicArtistLinks } from '../../../track/trackLinks.ts';

/** 网格条目稳定唯一键：映射在线对象的平台 ID */
export const refKey = (item: { readonly ref: { readonly id: string } }) => item.ref.id;

/** 按图块边长与像素比向图床要的封面地址；图块的图与悬停按钮取色读的是同一个，取色用浏览器已有的那份 */
const coverSrc = (cover: string, size: number) =>
  onlineCoverUrl(cover, size * (globalThis.devicePixelRatio || 1));

/** 在线封面：按图块边长与像素比向图床要图，加载失败画占位 */
function OnlineArt({
  cover,
  size,
  round,
}: {
  readonly cover: string | null;
  readonly size: number;
  readonly round: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = cover && failed !== cover ? coverSrc(cover, size) : '';
  return (
    <TileArt
      src={src}
      placeholder={round ? Person48Regular : Record48Regular}
      seen={() => false}
      lazy
      onLoad={() => {}}
      onError={() => setFailed(cover)}
    />
  );
}

/** 在线对象的图块：封面配合双行文字，艺人是圆形头像与居中单行名字 */
function Tile({
  cover,
  size,
  round = false,
  themed = false,
  ...props
}: {
  readonly cover: string | null;
  readonly size: number;
  readonly round?: boolean;
  /** 悬停按钮按这张卡自己的封面取色；缺省沿用所在页面的取色 */
  readonly themed?: boolean;
  readonly title: string;
  readonly detail?: string;
  readonly detailContent?: ReactNode;
  readonly aside?: string;
} & ObjectTileActions) {
  return (
    <ObjectTile
      {...props}
      art={<OnlineArt cover={cover} size={size} round={round} />}
      round={round}
      dataset={{ 'data-online-tile': true }}
      {...(themed
        ? {
            keysTheme: (keys: ReactElement) => (
              <CoverTheme url={cover ? coverSrc(cover, size) : ''} reuse>
                {keys}
              </CoverTheme>
            ),
          }
        : {})}
    />
  );
}

/**
 * 专辑图块：副标题缺省展示署名艺人，每位各自可点（超过三位整串弹菜单）；`firstArtistOnly` 只写第一署名（艺人页里
 * 「参与的专辑」一节）；`detail` 换成纯文字的自定义信息（如年份与类型），不再是艺人，`aside` 是右端的短字
 */
export function OnlineAlbumTile({
  album,
  detail,
  aside,
  firstArtistOnly = false,
  ...actions
}: {
  readonly album: MusicAlbum;
  readonly detail?: string;
  readonly aside?: string;
  readonly firstArtistOnly?: boolean;
} & ObjectTileActions) {
  const credits = useMemo(() => {
    const links = musicArtistLinks(album.artists);
    return firstArtistOnly ? links.slice(0, 1) : links;
  }, [album.artists, firstArtistOnly]);
  const names = credits.map((artist) => artist.text).join(', ');
  return (
    <Tile
      {...actions}
      cover={album.artwork}
      size={STANDARD_TILE_SIZE}
      themed
      title={album.title}
      detail={detail ?? names}
      detailContent={
        detail === undefined && credits.length > 0 ? (
          <LinkedArtists artists={credits} tabIndex={-1} />
        ) : undefined
      }
      aside={aside}
    />
  );
}

/** 歌单图块：副标题缺省写曲目数，`detail` 换成别的文字（如播放量） */
export function OnlinePlaylistTile({
  playlist,
  detail,
  ...actions
}: { readonly playlist: MusicPlaylist; readonly detail?: string } & ObjectTileActions) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const count = playlist.trackCount;
  return (
    <Tile
      {...actions}
      cover={playlist.cover}
      size={STANDARD_TILE_SIZE}
      title={playlist.title}
      detail={
        detail ??
        (count === null
          ? ''
          : t(plural(count, 'album.menuTracksOne', 'album.menuTracks'), { count }))
      }
    />
  );
}

export function OnlineArtistTile({
  artist,
  ...actions
}: { readonly artist: MusicArtist } & ObjectTileActions) {
  return (
    <Tile
      onOpen={actions.onOpen}
      onMenu={actions.onMenu}
      cover={artist.avatar}
      size={ARTIST_TILE_SIZE}
      round
      title={artist.name}
    />
  );
}
