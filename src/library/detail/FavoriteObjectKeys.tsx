import { Button, Tooltip, mergeClasses } from '@fluentui/react-components';
import {
  Add16Regular,
  Add20Regular,
  Checkmark16Regular,
  Checkmark20Regular,
  Heart20Filled,
  Heart20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import type { MusicAlbum, MusicArtist, MusicPlaylist } from '../../server/musicObjects.ts';
import { useFavorite, type FavoriteControl } from '../../track/useFavorite.ts';
import styles from './FavoriteObjectKeys.module.css';

/** 专辑、歌单页头的收藏键：与加入队列、更多同一排的圆形图标键，心形 20，收藏了是红色实心 */
function HeaderHeart({
  favorite,
  className,
}: {
  readonly favorite: FavoriteControl;
  /** 与同排的键同一份尺寸与颜色 */
  readonly className: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  if (!favorite.available) return null;
  const label = t(favorite.on ? 'favorite.remove' : 'favorite.add');
  return (
    <Tooltip content={label} relationship="label">
      <Button
        appearance="subtle"
        shape="circular"
        className={className}
        icon={{
          className: favorite.on ? styles.heart : undefined,
          children: favorite.on ? <Heart20Filled /> : <Heart20Regular />,
        }}
        aria-label={label}
        disabled={!favorite.enabled}
        data-favorite={favorite.on || undefined}
        data-detail-favorite
        onClick={favorite.toggle}
      />
    </Tooltip>
  );
}

export function FavoriteAlbumKey({
  album,
  className,
}: {
  readonly album: MusicAlbum;
  readonly className: string;
}) {
  return <HeaderHeart favorite={useFavorite('album', album.ref, album)} className={className} />;
}

export function FavoritePlaylistKey({
  playlist,
  className,
}: {
  readonly playlist: MusicPlaylist;
  readonly className: string;
}) {
  return (
    <HeaderHeart favorite={useFavorite('playlist', playlist.ref, playlist)} className={className} />
  );
}

/** 艺人名字后的关注键：24 的圆形小键，加号是未关注，勾是已关注 */
export function FollowKey({ artist }: { readonly artist: MusicArtist }) {
  const t = useAtomValueRawSync(translateAtom);
  const favorite = useFavorite('artist', artist.ref, artist);
  if (!favorite.available) return null;
  const label = t(favorite.on ? 'favorite.unfollow' : 'favorite.follow');
  return (
    <Tooltip content={label} relationship="label">
      <button
        type="button"
        className={styles.follow}
        aria-label={label}
        disabled={!favorite.enabled}
        data-followed={favorite.on || undefined}
        data-detail-follow
        onClick={(event) => {
          event.stopPropagation();
          favorite.toggle();
        }}
      >
        {favorite.on ? <Checkmark16Regular /> : <Add16Regular />}
      </button>
    </Tooltip>
  );
}

/** 艺人页头玻璃组最前的关注键：宽档带字，窄档只留图标；没有持续底，已关注靠勾与字分辨 */
export function FollowHeroKey({
  artist,
  labelled,
  className,
}: {
  readonly artist: MusicArtist;
  readonly labelled: boolean;
  readonly className: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const favorite = useFavorite('artist', artist.ref, artist);
  if (!favorite.available) return null;
  const action = t(favorite.on ? 'favorite.unfollow' : 'favorite.follow');
  return (
    <Tooltip content={action} relationship="label">
      <Button
        appearance="transparent"
        shape="circular"
        className={mergeClasses(className, labelled && styles.heroLabelled)}
        icon={{
          className: favorite.on ? styles.heroFollowed : undefined,
          children: favorite.on ? <Checkmark20Regular /> : <Add20Regular />,
        }}
        aria-label={action}
        disabled={!favorite.enabled}
        data-followed={favorite.on || undefined}
        data-artist-follow
        onClick={favorite.toggle}
      >
        {labelled ? t(favorite.on ? 'favorite.following' : 'favorite.follow') : undefined}
      </Button>
    </Tooltip>
  );
}
