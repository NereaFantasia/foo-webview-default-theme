import { Record48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { useCoverLoad } from '../../covers/useCoverLoad.ts';
import type { Album } from '../../host/libraryContract.ts';
import { useService } from '../../kit/useService.ts';
import { albumCoversVersionAtom } from '../albumCovers.ts';
import { albumsKey } from '../albumServices.ts';
import { TILE_SIZE_MAX } from '../albums/browserPrefs.ts';
import { TileArt } from './TileArt.tsx';

/**
 * 专辑图块封面容器：URL 请求、并发配额与缺图判定均代理至专辑封面服务，与封面墙共享缓存
 * 固定按尺寸上限请求封面，以稳定命中缩放缓存与悬停取色档案
 * 角标与悬停操作按钮通过 `children` 叠加；边长由外部 CSS 变量 `--tile-size` 控制
 */
export function AlbumTileArt({
  album,
  selected,
  children,
}: {
  readonly album: Album;
  readonly selected?: boolean;
  readonly children?: ReactNode;
}) {
  const albums = useService(albumsKey);
  useAtomValueRawSync(albumCoversVersionAtom);
  const cover = albums.covers.coverOf(album, TILE_SIZE_MAX);
  const ready = cover?.status === 'ready';
  const image = useCoverLoad(ready ? cover.url : '', (ready && cover.previous) || '', {
    acquire: () => albums.covers.acquire(album),
    settle: (outcome) => albums.covers.settle(album, outcome),
    wait: (retry) => albums.covers.wait(retry),
  });
  return (
    <TileArt
      src={image.src}
      placeholder={Record48Regular}
      seen={() => albums.covers.shown(album)}
      onLoad={image.onLoad}
      onError={image.onError}
      selected={selected}
    >
      {children}
    </TileArt>
  );
}
