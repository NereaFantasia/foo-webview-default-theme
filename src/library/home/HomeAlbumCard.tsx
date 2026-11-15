import { albumArtistOf, type Album } from '../../host/libraryContract.ts';
import { useService } from '../../kit/useService.ts';
import { albumArtistLink } from '../../track/trackLinks.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { TileLabels } from '../cover-tile/TileLabels.tsx';
import { HomeAlbumTile } from './HomeAlbumTile.tsx';
import styles from './HomeAlbumCard.module.css';

/** 首页专辑卡片组件：封面与悬停操作按钮在 `HomeAlbumTile`，这里接竖排的标题与艺人，嵌入平铺网格 CoverGrid */
export function HomeAlbumCard({
  album,
  onMenu,
  menuOwner,
}: {
  readonly album: Album;
  readonly onMenu: (album: Album, at: { x: number; y: number }, owner: string) => void;
  readonly menuOwner?: string;
}) {
  const albumDetail = useService(albumDetailKey);
  return (
    <HomeAlbumTile album={album} onMenu={onMenu} menuOwner={menuOwner} className={styles.root}>
      <div className={styles.labels} onClick={() => albumDetail.open(album)}>
        <TileLabels
          title={album.name}
          subtitle={albumArtistOf(album)}
          subtitleTo={albumArtistLink(album)?.ref}
        />
      </div>
    </HomeAlbumTile>
  );
}
