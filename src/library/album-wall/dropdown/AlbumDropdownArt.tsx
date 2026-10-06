import { Record48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './AlbumDropdownArt.module.css';
import { albumCoversVersionAtom } from '../../albumCovers.ts';
import { albumKeyOf, type Album } from '../../../host/libraryContract.ts';
import { useCoverLoad } from '../../../covers/useCoverLoad.ts';
import { useService } from '../../../kit/useService.ts';
import { albumsKey } from '../../albumServices.ts';

/** 换了专辑后，新封面最多等这么久，毫秒；过了还没画出来就撤掉旧图、先露占位。 */
const COVER_WAIT_MS = 150;

interface LayerProps {
  readonly album: Album;
  readonly size: number;
  /** 这一层的图画出了第一帧，开始淡入。 */
  readonly onLoaded: () => void;
  /** 淡入完了。 */
  readonly onShown: () => void;
}

/** 把地址写成 CSS 的 `url("…")`：引号、反斜杠与换行写成转义，别的原样。 */
function cssUrl(url: string): string {
  const escaped = url.replace(/["\\\n\r]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  return `url("${escaped}")`;
}

/**
 * 一张专辑的一层：左边的大封面与它往右的延伸（`AlbumDropdownArt.module.css` 的 `.extend`），同一个地址。
 * 画出第一帧才淡入，淡入完报上去，下面的旧层随之撤掉。封面照图块的规矩向封面服务借名额、报结局
 * （`useCoverLoad`）；延伸用的是同一个地址，走浏览器缓存，不另记账。
 */
function ArtLayer({ album, size, onLoaded, onShown }: LayerProps) {
  const albums = useService(albumsKey);
  useAtomValueRawSync(albumCoversVersionAtom);
  const cover = albums.covers.coverOf(album, size);
  const ready = cover?.status === 'ready';
  const image = useCoverLoad(ready ? cover.url : '', (ready && cover.previous) || '', {
    acquire: () => albums.covers.acquire(album),
    settle: (outcome) => albums.covers.settle(album, outcome),
    wait: (retry) => albums.covers.wait(retry),
  });
  const [loaded, setLoaded] = useState(false);
  const shown = loaded && image.src !== '';
  const source: CSSProperties & Record<`--${string}`, string> = {
    '--cover-image': cssUrl(image.src),
  };
  return (
    <>
      <div className={styles.extend} data-shown={shown || undefined} aria-hidden>
        {image.src && (
          <div className={styles.smear} style={source}>
            <span className={styles.band} />
            <span className={`${styles.band} ${styles.top}`} />
            <span className={`${styles.band} ${styles.bottom}`} />
          </div>
        )}
      </div>
      <div
        className={styles.cover}
        data-dropdown-cover
        data-shown={shown || undefined}
        onTransitionEnd={(event) => {
          if (shown && event.target === event.currentTarget) onShown();
        }}
      >
        {image.src && (
          <img
            className={styles.image}
            src={image.src}
            alt=""
            draggable={false}
            onLoad={() => {
              image.onLoad();
              setLoaded(true);
              onLoaded();
            }}
            onError={image.onError}
          />
        )}
      </div>
    </>
  );
}

export interface AlbumDropdownArtProps {
  readonly album: Album;
  /**
   * 取图的档位按它，CSS 像素：封面边长的上限，不随面板宽窄与首数变，每张专辑取同一档。框的实际边长由
   * 面板经 `--cover-size` 给。
   */
  readonly size: number;
}

/**
 * 下拉的封面与它往右的延伸，最上面压一层给字垫底的渐变。同一行换一张时新旧两层叠着：新的一层画出第一帧
 * 才淡入（83 ms 线性），淡入完撤掉旧的；新封面过了 150 ms 还没画出来，就先撤掉旧的、露出占位，到了再
 * 淡入。窗口变宽变窄时不重新渲染。
 */
export const AlbumDropdownArt = memo(function AlbumDropdownArt({
  album,
  size,
}: AlbumDropdownArtProps) {
  const [layers, setLayers] = useState<readonly Album[]>([album]);
  const top = layers[layers.length - 1];
  const key = albumKeyOf(album);
  // 换回还压在下面的那一张时把它挪到最上面，不另起一层。
  if (!top || albumKeyOf(top) !== key) {
    setLayers([...layers.filter((layer) => albumKeyOf(layer) !== key), album]);
  }
  const stacked = layers.length > 1;
  /** 已经画出第一帧的那一层；它自己淡入完会撤掉旧层，不必等时限。 */
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!stacked) return;
    const timer = setTimeout(() => {
      if (loaded.current !== key) setLayers((all) => all.slice(-1));
    }, COVER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [stacked, key]);
  return (
    <>
      <Record48Regular className={styles.placeholder} aria-hidden />
      {layers.map((layer) => {
        const layerKey = albumKeyOf(layer);
        return (
          <ArtLayer
            key={layerKey}
            album={layer}
            size={size}
            onLoaded={() => {
              loaded.current = layerKey;
            }}
            onShown={() => {
              if (layerKey === key) setLayers((all) => all.slice(-1));
            }}
          />
        );
      })}
      <div className={styles.scrim} aria-hidden />
    </>
  );
});
