import { Person48Regular, Record48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useMemo, useState, type ReactNode } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { onlineCoverUrl } from '../../../playback/onlineTracks.ts';
import type { MusicAlbum, MusicArtist, MusicPlaylist } from '../../../server/musicObjects.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import type { CoverGridShape } from '../../cover-tile/CoverGrid.tsx';
import { TileArt } from '../../cover-tile/TileArt.tsx';
import { TileKeys } from '../../cover-tile/TileKeys.tsx';
import { TileLabels } from '../../cover-tile/TileLabels.tsx';
import { STANDARD_TILE_SIZE } from '../../cover-tile/tileGeometry.ts';
import { useTileKeysHost } from '../../cover-tile/useTileKeysHost.ts';
import { LinkedArtists } from '../../../track/TrackCredits.tsx';
import { musicArtistLinks } from '../../../track/trackLinks.ts';
import { menuAt } from './OnlineItems.tsx';
import styles from './OnlineTiles.module.css';

/** 艺人头像的边长，CSS 像素 */
const ARTIST_TILE_SIZE = 120;

/**
 * 在线艺人网格规范：头像尺寸 120px 加单行文字，固定间距 24px 不随容器拉伸
 */
export const ONLINE_ARTIST_SHAPE: CoverGridShape = {
  size: ARTIST_TILE_SIZE,
  gap: 24,
  stretch: 1,
  textHeight: 18,
  lineHeight: 16,
};

/** 网格条目稳定唯一键：映射在线对象的平台 ID */
export const refKey = (item: { readonly ref: { readonly id: string } }) => item.ref.id;

/** 图块交互动作抽象：包含打开详情、上下文菜单及可选的起播处理 */
export interface OnlineTileActions {
  onOpen(): void;
  onMenu(at: TablePoint): void;
  onPlay?(): void;
}

/**
 * 专辑与歌单图块通用封装：封面配合双行文字，艺人模式采用圆形头像与居中单行名称。文字不在封面按钮里：
 * 副标题里的艺人名可点，按钮里不能再放链接；点文字空白处同样打开
 */
function Tile({
  cover,
  size,
  round = false,
  title,
  detail,
  detailContent,
  aside,
  onOpen,
  onMenu,
  onPlay,
}: {
  readonly cover: string | null;
  readonly size: number;
  readonly round?: boolean;
  readonly title: string;
  /** 副标题文本；省略时仅渲染单行标题 */
  readonly detail?: string;
  /** 副标题里的艺人各自可点时的排法，`detail` 仍写悬停提示 */
  readonly detailContent?: ReactNode;
  /** 副标题右侧辅助文本，需与 detail 配合传入 */
  readonly aside?: string;
} & OnlineTileActions) {
  const t = useAtomValueRawSync(translateAtom);
  const keys = useTileKeysHost();
  const [failed, setFailed] = useState<string | null>(null);
  const src =
    cover && failed !== cover
      ? onlineCoverUrl(cover, size * (globalThis.devicePixelRatio || 1))
      : '';
  return (
    <div
      className={styles.tile}
      data-round={round || undefined}
      data-online-tile
      {...keys.rootProps}
    >
      <button
        type="button"
        className={styles.face}
        aria-label={title}
        title={[title, detail].filter(Boolean).join('\n')}
        data-tile-face
        onClick={onOpen}
        onContextMenu={(event) => menuAt(event, onMenu)}
      >
        <TileArt
          src={src}
          placeholder={round ? Person48Regular : Record48Regular}
          seen={() => false}
          lazy
          onLoad={() => {}}
          onError={() => setFailed(cover)}
        />
      </button>
      <div
        className={styles.labels}
        onClick={onOpen}
        onContextMenu={(event) => menuAt(event, onMenu)}
      >
        <TileLabels title={title} subtitle={detail} subtitleContent={detailContent} aside={aside} />
      </div>
      {onPlay && keys.mounted && (
        <TileKeys
          hidden={keys.hidden}
          state="idle"
          playLabel={t('album.play')}
          style={{ width: 'var(--tile-size)', height: 'var(--tile-size)' }}
          onTransitionEnd={keys.onTransitionEnd}
          onPlay={onPlay}
          onMore={onMenu}
        />
      )}
    </div>
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
} & OnlineTileActions) {
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

export function OnlinePlaylistTile({
  playlist,
  ...actions
}: { readonly playlist: MusicPlaylist } & OnlineTileActions) {
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
        count === null ? '' : t(plural(count, 'album.menuTracksOne', 'album.menuTracks'), { count })
      }
    />
  );
}

export function OnlineArtistTile({
  artist,
  ...actions
}: { readonly artist: MusicArtist } & OnlineTileActions) {
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
