import { useEffect, useMemo } from 'react';
import type { LibraryTracksState } from '../libraryTracks.ts';
import { TrackFacets } from '../../track/TrackFacets.tsx';
import { trackFacetOptions } from '../../track/trackFacets.ts';
import type { TrackFilter } from '../../track/trackFilter.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';
import { useGenreValues } from '../useGenreValues.ts';

export function SongsFacets({
  filter,
  library,
  tabs,
}: {
  readonly filter: TrackFilter;
  readonly library: LibraryTracksState;
  readonly tabs: boolean;
}) {
  const songs = useService(songsKey);
  const valuesOf = useGenreValues(true);
  const options = useMemo(
    () => trackFacetOptions(library.byHandle.values(), valuesOf ?? undefined),
    [library.byHandle, valuesOf],
  );
  // 真实流派值读成之前按显示串拆的取值不全，不能据此剔勾选
  useEffect(() => {
    if (library.status === 'ready' && valuesOf) songs.filter.pruneFacets(options);
  }, [songs, options, library.status, valuesOf]);
  return (
    <TrackFacets
      filter={filter}
      options={options}
      onToggle={songs.filter.toggleFacet}
      tabs={tabs}
    />
  );
}
