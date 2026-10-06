import { Record48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo } from 'react';
import { albumCoversVersionAtom } from '../albumCovers.ts';
import { albumKeyOf, type Album } from '../../host/libraryContract.ts';
import { useCoverLoad } from '../../covers/useCoverLoad.ts';
import styles from './SongArt.module.css';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';

interface AlbumArtProps {
  readonly album: Album;
  readonly size: number;
}

/**
 * 一张专辑的封面：照封面墙图块的规矩向封面服务借名额、报结局。封面有了变化只重画这一格，不重画整行。
 */
function AlbumArt({ album, size }: AlbumArtProps) {
  const albums = useService(albumsKey);
  useAtomValueRawSync(albumCoversVersionAtom);
  const cover = albums.covers.coverOf(album, size);
  const ready = cover?.status === 'ready';
  const image = useCoverLoad(ready ? cover.url : '', (ready && cover.previous) || '', {
    acquire: () => albums.covers.acquire(album),
    settle: (outcome) => albums.covers.settle(album, outcome),
    wait: (retry) => albums.covers.wait(retry),
  });
  return image.src ? (
    <img
      className={styles.image}
      src={image.src}
      alt=""
      draggable={false}
      onLoad={image.onLoad}
      onError={image.onError}
    />
  ) : (
    <Record48Regular className={styles.placeholder} />
  );
}

export interface SongArtProps {
  /** 曲目所在的专辑；不属于哪张专辑、或专辑清单里还没有它时为 undefined，画占位。 */
  readonly album: Album | undefined;
  /** 边长，CSS 像素。 */
  readonly size: number;
}

/**
 * 歌曲表一行左边的缩略图。同一张专辑的各首共用专辑封面，地址、名额与缺图判定都走专辑封面服务，与封面墙共用
 * 缓存。换了专辑时整个重挂，旧专辑还没有结局的名额随之还掉。读屏念标题就够了，缩略图不念。
 */
export const SongArt = memo(function SongArt({ album, size }: SongArtProps) {
  return (
    <span className={styles.art} style={{ width: size, height: size }} data-song-art aria-hidden>
      {album ? (
        <AlbumArt key={albumKeyOf(album)} album={album} size={size} />
      ) : (
        <Record48Regular className={styles.placeholder} />
      )}
    </span>
  );
});
