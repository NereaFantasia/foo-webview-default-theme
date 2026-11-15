import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { albumKeyOf, albumYearOf } from '../../../host/libraryContract.ts';
import { translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import type { TablePoint } from '../../../table/tableItems.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import { AlbumColorTheme } from '../../AlbumColorTheme.tsx';
import { AlbumMenu } from '../../AlbumMenu.tsx';
import { albumsKey } from '../../albumServices.ts';
import { AlbumTileArt } from '../../cover-tile/AlbumTileArt.tsx';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../../cover-tile/CoverGrid.tsx';
import { ObjectTile } from '../../cover-tile/ObjectTile.tsx';
import { newestFirst } from '../albumOrder.ts';
import { useArtists } from '../artistsContext.ts';
import styles from './ArtistAlbums.module.css';

/** 默认预览行数：个人专辑默认展示两行，参与作品展示一行；超出部分支持原地展开 */
const PREVIEW_ROWS = { own: 2, guest: 1 } as const;

/** 详情加载中或加载失败状态提示，在专辑与参与作品分段之外统一展示一次 */
export function ArtistAlbumsStatus() {
  const services = useArtists();
  const viewControls = useViewControlStyles();
  const state = useAtomValueRawSync(services.detail.state);
  const t = useAtomValueRawSync(translateAtom);
  const loading = state.status === 'loading' || state.status === 'idle';
  const problem =
    state.status === 'failed' || state.refreshFailed || state.partial || state.guestPending;
  return (
    <>
      {loading && <Spinner size="small" aria-label={t('artists.loading')} />}
      {problem && (
        <div className={styles.notice} role="alert">
          {t(
            state.refreshFailed
              ? 'artists.refreshFailed'
              : state.partial
                ? 'artists.partial'
                : state.guestPending
                  ? 'artists.guestPending'
                  : 'artists.failed',
          )}
          <Button className={viewControls.field} size="small" onClick={services.retry}>
            {t('artists.retry')}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * 艺人个人专辑或参与作品分段列表：复用专辑墙图块，按发行时间降序排列
 *
 * 悬停显示播放与更多操作，右键弹出专辑菜单；超出预览行数时支持原地展开全部内容
 */
export function ArtistAlbums({ section }: { readonly section: 'own' | 'guest' }) {
  const services = useArtists();
  const albums = useService(albumsKey);
  const controls = useViewControlStyles();
  const state = useAtomValueRawSync(services.detail.state);
  const t = useAtomValueRawSync(translateAtom);
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [expanded, setExpanded] = useState(false);
  const groups = newestFirst(state.detail?.[section] ?? [], (group) => group.album);
  if (!groups.length) return null;
  const title = t(`artists.${section}`);
  return (
    <section aria-label={title} data-artist-albums={section}>
      <CoverGrid
        shape={STANDARD_GRID_SHAPE}
        items={groups}
        keyOf={(group) => albumKeyOf(group.album)}
        label={title}
        {...(expanded ? {} : { previewRows: PREVIEW_ROWS[section] })}
        header={({ overflow }) => (
          <div className={styles.head}>
            <h2 className={styles.heading}>{title}</h2>
            {(overflow || expanded) && (
              <Button
                appearance="transparent"
                size="small"
                className={controls.plain}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? t('artists.showLess') : t('artists.showAll', { count: groups.length })}
              </Button>
            )}
          </div>
        )}
        render={({ album }) => (
          <ObjectTile
            art={<AlbumTileArt album={album} />}
            title={album.name}
            detail={albumYearOf(album)}
            dataset={{ 'data-artist-album': albumKeyOf(album) }}
            keysTheme={(keys) => <AlbumColorTheme album={album}>{keys}</AlbumColorTheme>}
            onOpen={() => services.openAlbum(album)}
            onPlay={() => void albums.actions.play(album)}
            onMenu={(at) => {
              void albums.menu.prepare([album]);
              setMenuAt(at);
            }}
          />
        )}
      />
      <AlbumMenu at={menuAt} onClose={() => setMenuAt(null)} />
    </section>
  );
}
