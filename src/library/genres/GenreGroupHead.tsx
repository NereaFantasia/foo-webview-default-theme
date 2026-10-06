import { ChevronRight16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import type { TableGroupItem, TablePoint } from '../../table/tableItems.ts';
import type { TableGroupState } from '../../table/TrackTable.tsx';
import { SongArt } from '../songs/SongArt.tsx';
import type { GenreGroup } from './genresGroups.ts';
import styles from './GenreGroupHead.module.css';
import { useService } from '../../kit/useService.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

export interface GenreGroupHeadProps {
  readonly item: TableGroupItem<GenreGroup>;
  readonly state: TableGroupState;
  readonly coverWidth: number;
  readonly onAlbumMenu: (point: TablePoint) => void;
}
export function GenreGroupHead({ item, state, coverWidth, onAlbumMenu }: GenreGroupHeadProps) {
  const t = useAtomValueRawSync(translateAtom);
  const albumDetail = useService(albumDetailKey);
  const group = item.data;
  const album = group.album;
  const label =
    group.disc !== null
      ? t('genres.disc', { number: group.disc })
      : group.label || t('genres.missingGroup');
  return (
    <>
      <div
        className={styles.head}
        data-genre-group={label}
        data-disc={group.disc !== null || undefined}
      >
        <button
          className={styles.toggle}
          data-expanded={!item.collapsed}
          type="button"
          tabIndex={-1}
          aria-label={t('genres.toggle')}
          onClick={state.toggle}
        >
          <ChevronRight16Regular />
        </button>
        {album ? (
          <button
            className={styles.link}
            type="button"
            tabIndex={-1}
            onClick={() => albumDetail.open(album)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAlbumMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            {label}
          </button>
        ) : (
          <span className={styles.name}>{label}</span>
        )}
        {album && <span className={styles.artist}>{album.albumArtist || album.artist}</span>}
        <span className={styles.line} />
        <span className={styles.count}>
          {t('genres.tracks', { count: group.end - group.start })}
        </span>
        {album && <span className={styles.count}>{album.year.slice(0, 4)}</span>}
      </div>
      {album && !item.collapsed && coverWidth > 0 && (
        <button
          type="button"
          tabIndex={-1}
          className={styles.cover}
          data-table-group-body
          style={{ width: coverWidth, height: coverWidth }}
          aria-label={t('genres.openAlbum', { name: album.name })}
          onClick={() => albumDetail.open(album)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAlbumMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <SongArt album={album} size={coverWidth} />
        </button>
      )}
    </>
  );
}
