import { COLUMN_PREFS } from '../../table/columns/columnMigration.ts';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useMemo, useState } from 'react';
import { createColumnsModel } from '../../table/columns/columnsModel.ts';
import { createRowSelection } from '../../table/rowSelection.ts';
import {
  EXTENDED_COLUMNS,
  EXTENDED_INTRODUCED,
  type ColumnId,
} from '../../table/columns/columns.ts';
import { albumsAtom } from '../albums.ts';
import { buildGenreGroups, genreTableItems } from './genresGroups.ts';
import { genresPrefsAtom } from './genresPrefs.ts';
import { genresRowsAtom } from './genresRows.ts';
import { TRACK_STATS_COLUMNS } from '../../track/trackSort.ts';
import { useTrackStats } from '../useTrackStats.ts';

const COLUMNS: readonly ColumnId[] = [
  'cover',
  'status',
  'number',
  'title',
  'artist',
  'album',
  'rating',
  'duration',
  ...EXTENDED_COLUMNS,
];

export function useGenresTable(closed: ReadonlySet<string>) {
  const store = useStore();
  const rows = useAtomValueRawSync(genresRowsAtom);
  const { group } = useAtomValueRawSync(genresPrefsAtom);
  const { albums } = useAtomValueRawSync(albumsAtom);
  // 按专辑分组时封面列由组头撑起；别的分组或不分组没有这样的组头，换成每行一张的缩略图列
  const withCovers = group === 'album' || group === 'albumDisc';
  const columns = useMemo(
    () =>
      createColumnsModel(store, {
        ...COLUMN_PREFS.genres,
        offered: withCovers
          ? COLUMNS
          : COLUMNS.map((column) => (column === 'cover' ? 'art' : column)),
        hidden: ['status', 'album', ...EXTENDED_COLUMNS],
        widths: { cover: 128 },
        introduced: EXTENDED_INTRODUCED,
      }),
    [store, withCovers],
  );
  const { coverWidth, cells } = useAtomValueRawSync(columns.layout);
  // 按统计排序由宿主排，这里只为显示统计列取数
  const stats = useTrackStats(
    rows.tracks,
    cells.some((id) => TRACK_STATS_COLUMNS.has(id)),
  );
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
    () => genreTableItems(stats.tracks, groups, closed, coverWidth),
    [stats.tracks, groups, closed, coverWidth],
  );
  return {
    rows,
    columns,
    selection,
    groups,
    items,
    coverWidth,
    group,
    statsFailed: stats.failed,
    retryStats: stats.retry,
  };
}
