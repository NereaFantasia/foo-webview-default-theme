import type { LibraryTrack } from 'foo-webview-sdk';
import { useEffect, useMemo, useState } from 'react';
import { useAtomValueRawSync } from 'jotai/react';
import { createColumnsModel } from '../../../table/columns/columnsModel.ts';
import { createRowSelection } from '../../../table/rowSelection.ts';
import { rowsOf } from '../../../table/rangeSelection.ts';
import { TrackTable } from '../../../table/TrackTable.tsx';
import type {
  TableArtwork,
  TableLinks,
  TablePoint,
  TableTrack,
} from '../../../table/tableItems.ts';
import { TrackMenu } from '../../TrackMenu.tsx';
import { SongArt } from '../../songs/SongArt.tsx';
import { trackPathOf } from '../../../host/libraryContract.ts';
import { useArtists } from '../artistsContext.ts';

export interface ArtistHighlightRow {
  readonly rank: number;
  readonly track: LibraryTrack;
  readonly plays: number;
}
export function ArtistHighlightTable({
  rows,
  scroll,
  label,
}: {
  readonly rows: readonly ArtistHighlightRow[];
  readonly scroll: HTMLElement | null;
  readonly label: string;
}) {
  const services = useArtists();
  const state = useAtomValueRawSync(services.detail.state);
  const [menuAt, setMenuAt] = useState<TablePoint | null>(null);
  const [menuRows, setMenuRows] = useState(rows);
  const columns = useMemo(
    () =>
      createColumnsModel(services.store, {
        key: 'default-theme.artists-highlights-columns.v1',
        offered: ['number', 'art', 'title', 'album', 'playCount', 'rating', 'duration'],
        hidden: ['rating'],
      }),
    [services.store],
  );
  const [selection] = useState(() => createRowSelection(services.store, { total: 0 }));
  useEffect(() => {
    selection.clear();
    selection.setTotal(rows.length);
  }, [selection, rows]);
  const items = useMemo(
    () =>
      rows.map((row, order) => ({
        kind: 'row' as const,
        key: `${row.track.handle}:${order}`,
        order,
        track: { ...row.track, playCount: row.plays },
      })),
    [rows],
  );
  const numbers = useMemo(
    () => new Map<TableTrack, number>(items.map((item, at) => [item.track, rows[at]?.rank ?? 0])),
    [items, rows],
  );
  const numberText = useMemo(
    () => (track: TableTrack) => String(numbers.get(track) ?? ''),
    [numbers],
  );
  const groups = useMemo(
    () => (state.detail ? [...state.detail.own, ...state.detail.guest] : []),
    [state.detail],
  );
  const albumFor = useMemo(() => {
    const byPath = new Map(
      groups.flatMap((group) =>
        group.tracks.map((track) => [trackPathOf(track), group.album] as const),
      ),
    );
    return (track: TableTrack) => byPath.get(trackPathOf(track));
  }, [groups]);
  const artwork = useMemo<TableArtwork>(
    () => (track, size) => <SongArt album={albumFor(track)} size={size} />,
    [albumFor],
  );
  const links = useMemo<TableLinks>(
    () => ({
      album: (track) => {
        const album = albumFor(track);
        if (album) services.openAlbum(album);
      },
    }),
    [albumFor, services],
  );
  return (
    <>
      <TrackTable
        columns={columns}
        items={items}
        selection={selection}
        label={label}
        rowHeight={40}
        ratingStamp={state.stamp}
        numberText={numberText}
        artwork={artwork}
        links={links}
        scrollParent={scroll}
        rank={(item, text) =>
          item.kind === 'row' && item.track?.title.toLocaleLowerCase().startsWith(text)
            ? 0
            : undefined
        }
        onPlay={(index) => {
          if (!rows[index] || !state.subject) return;
          void services.actions.play(
            [state.subject],
            false,
            rows.map((row) => row.track),
            index,
          );
        }}
        onMenu={(target, point) => {
          if (target.kind !== 'rows') return;
          const tracks = rowsOf(target.rows).flatMap((at) => rows[at]?.track ?? []);
          if (!tracks.length) return;
          setMenuRows(rows);
          void services.trackMenu.prepare(tracks, rows[target.index]?.track, state.stamp);
          setMenuAt(point);
        }}
      />
      <TrackMenu at={menuAt} onClose={() => setMenuAt(null)} isCurrent={() => menuRows === rows} />
    </>
  );
}
