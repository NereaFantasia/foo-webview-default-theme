import { useAtomValueRawSync } from 'jotai/react';
import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import { useService } from '../../kit/useService.ts';
import { playbackKey } from '../../playback/playbackContract.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { AlbumColorTheme } from '../AlbumColorTheme.tsx';
import { AlbumTileArt } from '../cover-tile/AlbumTileArt.tsx';
import { PlayingBadge } from '../cover-tile/TileBadges.tsx';
import { TileKeys } from '../cover-tile/TileKeys.tsx';
import { playbackPausedAtom, playingAlbumKeyAtom } from '../playingAlbum.ts';
import { useHomeServices } from './homeContext.ts';
import styles from './HomeAlbumTile.module.css';

/**
 * 首页专辑卡片的共用骨架：封面、悬停显现的操作按钮、主题色提取与右键菜单；封面下面或旁边的文字区由 `children` 给，
 * 版式（竖排的平铺格、横排的候选卡）由调用方经 `className` 定，封面边长由外面的 `--tile-size` 给
 * 悬停、键盘聚焦与弹出菜单时显现操作按钮；按钮淡出期间维持专辑主题色提取，淡出完成后重置为全局色
 */
export function HomeAlbumTile({
  album,
  onMenu,
  menuOwner,
  className,
  children,
}: {
  readonly album: Album;
  readonly onMenu: (album: Album, at: { x: number; y: number }, owner: string) => void;
  readonly menuOwner?: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const albumDetail = useService(albumDetailKey);
  const playback = useService(playbackKey);
  const home = useHomeServices();
  const busy = useAtomValueRawSync(home.busy);
  const playingKey = useAtomValueRawSync(playingAlbumKeyAtom);
  const paused = useAtomValueRawSync(playbackPausedAtom);
  const owner = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // 菜单把焦点移入浮层后，触发卡片仍保留自己的颜色；同专辑的其他卡片不跟随
  const active = hovered || focused || menuOwner === owner;
  const [themed, setThemed] = useState(false);
  if (active && !themed) setThemed(true);
  const playing = albumKeyOf(album) === playingKey;
  const menu = (event: MouseEvent) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu(album, { x: event.clientX || rect.left, y: event.clientY || rect.bottom }, owner);
  };
  return (
    <article
      className={className}
      data-home-album={album.name}
      data-home-item={JSON.stringify([album.name, album.albumArtist])}
      data-active={active || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onContextMenu={menu}
    >
      <div className={styles.cover}>
        <button
          className={styles.open}
          type="button"
          aria-label={album.name}
          data-tile-face
          onClick={() => albumDetail.open(album)}
        >
          <AlbumTileArt album={album}>
            {playing && <PlayingBadge audible={!paused} covered={active} />}
          </AlbumTileArt>
        </button>
        <AlbumColorTheme album={themed ? album : null}>
          <TileKeys
            data-home-keys
            hidden={!active}
            state={playing ? (paused ? 'paused' : 'playing') : 'idle'}
            playLabel={playing ? undefined : t('album.play')}
            playDisabled={busy}
            tabbable
            style={{ width: 'var(--tile-size)', height: 'var(--tile-size)' }}
            onTransitionEnd={(event) => {
              if (
                !active &&
                event.target === event.currentTarget &&
                event.propertyName === 'opacity'
              )
                setThemed(false);
            }}
            onPlay={() => {
              if (playing) void playback.playOrPause();
              else void home.playAlbum(album);
            }}
            onMore={(point) => onMenu(album, point, owner)}
          />
        </AlbumColorTheme>
      </div>
      {children}
    </article>
  );
}
