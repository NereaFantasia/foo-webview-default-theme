import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { createColumnsModel } from '../../table/columns/columnsModel.ts';
import { createRowSelection } from '../../table/rowSelection.ts';
import type { ColumnId } from '../../table/columns/columns.ts';
import type { TableLinks } from '../../table/tableItems.ts';
import { albumsAtom } from '../albums.ts';
import { albumKeyOf, trackAlbumKeyOf } from '../../host/libraryContract.ts';
import { buildGenreGroups, genreTableItems } from './genresGroups.ts';
import { genresPrefsAtom } from './genresPrefs.ts';
import { genresRowsAtom } from './genresRows.ts';
import { useService } from '../../kit/useService.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';

const COLUMNS: readonly ColumnId[] = [
  'cover',
  'status',
  'number',
  'title',
  'artist',
  'album',
  'rating',
  'duration',
];

export function useGenresTable(closed: ReadonlySet<string>) {
  const store = useStore();
  const albumDetail = useService(albumDetailKey);
  const rows = useAtomValueRawSync(genresRowsAtom);
  const { group } = useAtomValueRawSync(genresPrefsAtom);
  const { albums } = useAtomValueRawSync(albumsAtom);
  const withCovers = group === 'album' || group === 'albumDisc';
  const columns = useMemo(
    () =>
      createColumnsModel(store, {
        key: 'default-theme.genres-columns.v1',
        offered: withCovers ? COLUMNS : COLUMNS.filter((column) => column !== 'cover'),
        hidden: ['status', 'album'],
        widths: { cover: 128 },
      }),
    [store, withCovers],
  );
  const { coverWidth } = useAtomValueRawSync(columns.layout);
  const [selection] = useState(() => createRowSelection(store, { total: 0 }));
  useEffect(() => {
    selection.clear();
    selection.setTotal(rows.tracks.length);
  }, [selection, rows.tracks]);
  const groups = useMemo(
    () => buildGenreGroups(rows.tracks, group, albums),
    [rows.tracks, group, albums],
  );
  const items = useMemo(
    () => genreTableItems(rows.tracks, groups, closed, coverWidth),
    [rows.tracks, groups, closed, coverWidth],
  );
  const links = useMemo<TableLinks>(() => {
    const index = new Map(albums.map((album) => [albumKeyOf(album), album]));
    const tracks = new Map(rows.tracks.map((track) => [track.handle, track]));
    return {
      album: (track) => {
        const full = tracks.get(track.handle);
        const key = full ? trackAlbumKeyOf(full) : null;
        const album = key ? index.get(key) : undefined;
        if (album) albumDetail.open(album);
      },
    };
  }, [albums, rows.tracks, albumDetail]);
  return { rows, columns, selection, groups, items, coverWidth, links, group };
}
