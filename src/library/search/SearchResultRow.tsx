import { useAtomValueRawSync } from 'jotai/react';
import { memo, useId, useRef, type MouseEvent } from 'react';
import { useCommand } from '../../nav/useCommand.ts';
import { durationText } from '../../table/cellText.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { albumArtistOf, albumYearOf } from '../../host/libraryContract.ts';
import { SongArt } from '../songs/SongArt.tsx';
import { searchHitKey, type SearchHit } from './searchQuery.ts';
import styles from './SearchResultRow.module.css';
import { useService } from '../../kit/useService.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import type { Modifiers } from '../../kit/keyedSelection.ts';

export interface SearchResultRowProps {
  readonly hit: SearchHit;
  readonly id?: string;
  readonly selected?: boolean;
  readonly focused?: boolean;
  readonly option?: boolean;
  readonly tile?: boolean;
  readonly position?: number;
  readonly total?: number;
  onOpen?(): void;
  onPlay?(): void;
  onActivate?(hit: SearchHit, play: boolean): void;
  onSelect?(hit: SearchHit, modifiers: Modifiers): void;
  onMenu?(hit: SearchHit, at: TablePoint): void;
}

export const SearchResultRow = memo(function SearchResultRow({
  hit,
  id,
  selected,
  focused,
  option,
  tile,
  onOpen,
  onPlay,
  onActivate,
  onSelect,
  onMenu,
  position,
  total,
}: SearchResultRowProps) {
  const button = useRef<HTMLButtonElement>(null);
  const command = useId();
  useCommand({
    id: `${command}.enter`,
    layer: 'widget',
    keys: [{ key: 'Enter' }],
    enabled: () =>
      !!button.current &&
      document.activeElement === button.current &&
      !button.current.closest('[inert]'),
    run: () => {
      if (onPlay || onOpen) (onPlay ?? onOpen)?.();
      else onActivate?.(hit, hit.kind === 'track');
    },
  });
  useCommand({
    id: `${command}.menu`,
    layer: 'widget',
    keys: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
    enabled: () =>
      !!onMenu && document.activeElement === button.current && !button.current?.closest('[inert]'),
    run: () => {
      const rect = button.current?.getBoundingClientRect();
      if (rect) onMenu?.(hit, { x: rect.left + 16, y: rect.top + 24 });
    },
  });
  const open = () => {
    if (onOpen) onOpen();
    else onActivate?.(hit, false);
  };
  const contextMenu = (event: MouseEvent) => {
    if (!onMenu) return;
    event.preventDefault();
    onMenu(hit, { x: event.clientX, y: event.clientY });
  };
  const albumDetail = useService(albumDetailKey);
  const t = useAtomValueRawSync(translateAtom);
  const album = hit.kind === 'album' ? hit.album : (albumDetail.findAlbum(hit.track) ?? undefined);
  const title = hit.kind === 'album' ? hit.album.name : hit.track.title || hit.track.path || '';
  const subtitle =
    hit.kind === 'album'
      ? [albumArtistOf(hit.album), albumYearOf(hit.album)].filter(Boolean).join(' · ')
      : [hit.track.artist, hit.track.album].filter(Boolean).join(' · ');
  const content = (
    <>
      <SongArt album={album} size={tile ? 128 : 40} />
      <span className={styles.labels}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>
      {!tile && (
        <span className={styles.tail}>
          {hit.kind === 'album' ? t('search.albums') : durationText(hit.track.duration ?? 0)}
        </span>
      )}
    </>
  );
  if (option)
    return (
      <div
        id={id}
        role="option"
        aria-selected={selected ?? false}
        aria-posinset={position}
        aria-setsize={total}
        className={tile ? styles.tile : styles.row}
        data-search-hit={encodeURIComponent(searchHitKey(hit))}
        data-selected={selected || undefined}
        data-focused={focused || undefined}
        title={`${title}\n${subtitle}`}
        onPointerDown={(event) => {
          if (event.button === 0) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.detail < 2)
            onSelect?.(hit, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
        }}
        onDoubleClick={(event) => {
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey)
            onActivate?.(hit, hit.kind === 'track');
        }}
        onContextMenu={contextMenu}
      >
        {content}
      </div>
    );
  return (
    <button
      ref={button}
      type="button"
      data-search-hit={encodeURIComponent(searchHitKey(hit))}
      className={tile ? styles.tile : styles.row}
      title={`${title}\n${subtitle}`}
      onClick={open}
      onContextMenu={contextMenu}
    >
      {content}
    </button>
  );
});
