import { MicRegular, Person48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { Metadata, MetadataItem } from '../../../kit/Metadata.tsx';
import { albumKeyOf, type Album, type AlbumKey } from '../../../host/libraryContract.ts';
import { albumCoversVersionAtom } from '../../albumCovers.ts';
import { albumsAtom } from '../../albums.ts';
import { TILE_SIZE_MAX } from '../../albums/browserPrefs.ts';
import { AlbumTileArt } from '../../cover-tile/AlbumTileArt.tsx';
import { CoverGrid } from '../../cover-tile/CoverGrid.tsx';
import { ARTIST_GRID_SHAPE, ObjectTile } from '../../cover-tile/ObjectTile.tsx';
import { TileArt } from '../../cover-tile/TileArt.tsx';
import type { ApplePhoto } from '../../biography/biographyModel.ts';
import { applePhotoUrl } from '../../biography/online/fetchApplePhoto.ts';
import { useArtists } from '../artistsContext.ts';
import { newestFirst } from '../albumOrder.ts';
import { filterArtists } from '../artistCatalog.ts';
import type { ArtistRow } from '../artistIndex.ts';
import { isCompilation } from '../artistNames.ts';
import { ArtistListTools } from './ArtistListTools.tsx';
import styles from './ArtistWall.module.css';

const noop = () => {};

/** 获取艺人名下发行年份最新的专辑，供墙面图块解析封面 */
function newestAlbum(
  keys: readonly AlbumKey[],
  albums: ReadonlyMap<AlbumKey, Album>,
): Album | undefined {
  const known = keys.flatMap((key) => albums.get(key) ?? []);
  return newestFirst(known, (album) => album)[0];
}

/**
 * 艺人头像渲染：
 * 1. 优先读取对应专辑的内嵌或本地 artist 图像（通过宿主封面设置匹配）
 * 2. 缺失时回退至缓存中的 Apple 艺术照（`apple`）
 * 3. 仍缺失或加载失败时回退至专辑封面
 *
 * 合辑或未指定艺人的条目不拉取艺人图及 Apple 艺术照；各档位分别挂载独立图块并在切换时取消旧请求
 */
function ArtistArt({
  album,
  compilation,
  apple,
}: {
  readonly album?: Album;
  readonly compilation: boolean;
  readonly apple: ApplePhoto | null;
}) {
  const services = useArtists();
  const [failed, setFailed] = useState('');
  useAtomValueRawSync(albumCoversVersionAtom);
  const missing =
    !album || compilation || services.art.coverOf(album, TILE_SIZE_MAX)?.status === 'missing';
  const url = apple ? applePhotoUrl(apple) : '';
  if (missing && url && url !== failed)
    return (
      <TileArt
        key="apple"
        src={url}
        placeholder={Person48Regular}
        seen={() => false}
        lazy
        onLoad={noop}
        onError={() => setFailed(url)}
      />
    );
  if (!album)
    return (
      <TileArt
        src=""
        placeholder={Person48Regular}
        seen={() => false}
        onLoad={noop}
        onError={noop}
      />
    );
  return (
    <AlbumTileArt
      key={missing ? 'front' : 'artist'}
      album={album}
      covers={missing ? undefined : services.art}
      placeholder={Person48Regular}
    />
  );
}

export interface ArtistWallProps {
  readonly text: string;
  readonly tidy: boolean;
  /** 网格所在的外部滚动容器，条目较多时据此开启虚拟视口；挂载前为 null */
  readonly scroller: HTMLElement | null;
  onText(value: string): void;
  onTidy(value: boolean): void;
  onMenu(name: string, x: number, y: number): void;
}

/** 艺人封面墙：包含页头、筛选栏与圆形头像网格；点击头像跳转至艺人详情页 */
export function ArtistWall(props: ArtistWallProps) {
  const services = useArtists();
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const catalog = useAtomValueRawSync(services.catalog.state);
  const prefs = useAtomValueRawSync(services.prefs.state);
  const marked = useAtomValueRawSync(services.tidy.compilations);
  const applePhotoOf = useAtomValueRawSync(services.biography.wallPhoto);
  const library = useAtomValueRawSync(albumsAtom);
  const albums = useMemo(
    () => new Map(library.albums.map((album) => [albumKeyOf(album), album])),
    [library.albums],
  );
  const rows = useMemo(
    () =>
      filterArtists(
        catalog.rows,
        props.text,
        prefs,
        locale,
        props.tidy ? catalog.issues : undefined,
      ),
    [catalog, props.text, props.tidy, prefs, locale],
  );
  const detailOf = (row: ArtistRow) => {
    const issue = catalog.issues.get(row.name)?.[0];
    if (props.tidy && issue)
      return issue.kind === 'duplicate'
        ? t('artists.duplicate', { name: issue.others[0] ?? '' })
        : t('artists.multiple');
    return t(plural(row.albumCount, 'album.countOne', 'album.count'), { count: row.albumCount });
  };
  return (
    <>
      <header className={styles.heading}>
        <h1>{t('artists.title')}</h1>
        <Metadata>
          <MetadataItem icon={<MicRegular />} label={t('trackInfo.artist')}>
            {t('artists.total', { count: catalog.rows.length })}
          </MetadataItem>
        </Metadata>
      </header>
      <ArtistListTools
        text={props.text}
        tidy={props.tidy}
        onText={props.onText}
        onTidy={props.onTidy}
      />
      <CoverGrid
        shape={ARTIST_GRID_SHAPE}
        items={rows}
        keyOf={(row) => row.name}
        label={t('artists.title')}
        scroller={props.scroller}
        render={(row) => {
          const compilation = !row.name || isCompilation(row.name, marked);
          return (
            <ObjectTile
              round
              art={
                <ArtistArt
                  album={newestAlbum(row.albums, albums)}
                  compilation={compilation}
                  apple={compilation ? null : applePhotoOf(row.name)}
                />
              }
              title={row.name || t('artists.unknown')}
              detail={detailOf(row)}
              dataset={{ 'data-artist': row.name }}
              onOpen={() => services.places.open(row.name)}
              onMenu={(at) => props.onMenu(row.name, at.x, at.y)}
            />
          );
        }}
      />
      {!rows.length && (
        <p className={styles.empty}>{t(props.tidy ? 'artists.noIssues' : 'artists.noMatch')}</p>
      )}
    </>
  );
}
