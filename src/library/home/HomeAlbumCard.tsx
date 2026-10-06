import { Button, Tooltip } from '@fluentui/react-components';
import { MoreHorizontal20Regular, Play20Filled } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { albumArtistOf, type Album } from '../../host/libraryContract.ts';
import { SongArt } from '../songs/SongArt.tsx';
import { durationText } from '../../table/cellText.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { AlbumColorTheme } from '../AlbumColorTheme.tsx';
import { useHomeServices } from './homeContext.ts';
import styles from './HomeAlbumCard.module.css';
import { useService } from '../../kit/useService.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

export function HomeAlbumCard({
  album,
  onMenu,
  menuOwner,
  compact = false,
}: {
  readonly album: Album;
  readonly onMenu: (album: Album, at: { x: number; y: number }, owner: string) => void;
  readonly menuOwner?: string;
  readonly compact?: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const albumDetail = useService(albumDetailKey);
  const home = useHomeServices();
  const busy = useAtomValueRawSync(home.busy);
  const owner = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // 菜单把焦点移入浮层后，触发卡片仍保留自己的颜色；同专辑的其他卡片不跟随。
  const active = hovered || focused || menuOwner === owner;
  const art = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState(140);
  useLayoutEffect(() => {
    const element = art.current;
    if (!element) return;
    const measure = () => setSize(Math.max(1, Math.floor(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const menu = (event: MouseEvent) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu(album, { x: event.clientX || rect.left, y: event.clientY || rect.bottom }, owner);
  };
  return (
    <article
      className={`${styles.root} ${compact ? styles.compact : ''}`}
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
          ref={art}
          className={styles.open}
          type="button"
          aria-label={album.name}
          onClick={() => albumDetail.open(album)}
        >
          <SongArt album={album} size={size} />
        </button>
        <AlbumColorTheme album={active ? album : null}>
          <div className={styles.actions}>
            <Tooltip content={t('album.play')} relationship="label">
              <PrimaryPlayButton
                shape="circular"
                icon={<Play20Filled />}
                aria-label={t('album.play')}
                disabled={busy}
                onClick={() => void home.playAlbum(album)}
              />
            </Tooltip>
            <Tooltip content={t('menu.more')} relationship="label">
              <Button
                appearance="primary"
                shape="circular"
                icon={<MoreHorizontal20Regular />}
                aria-label={t('menu.more')}
                onClick={menu}
              />
            </Tooltip>
          </div>
        </AlbumColorTheme>
      </div>
      <div className={styles.metadata}>
        <button
          className={styles.title}
          type="button"
          onClick={() => albumDetail.open(album)}
          title={album.name}
        >
          {album.name}
        </button>
        <span className={styles.artist} title={albumArtistOf(album)}>
          {albumArtistOf(album)}
        </span>
        {compact && (
          <span className={styles.artist}>
            {t('home.albumTracks', { count: album.trackCount })} · {durationText(album.duration)}
          </span>
        )}
      </div>
    </article>
  );
}
