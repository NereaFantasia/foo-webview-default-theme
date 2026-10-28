import { useMemo } from 'react';
import type { LibraryTrack } from 'foo-webview-sdk';
import { TrackFacets } from '../../../track/TrackFacets.tsx';
import { trackFacetOptions } from '../../../track/trackFacets.ts';
import type { TrackFilter } from '../../../track/trackFilter.ts';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { useGenreValues } from '../../useGenreValues.ts';

export function FoldersFacets({
  tracks,
  filter,
  tabs,
}: {
  readonly tracks: readonly LibraryTrack[];
  readonly filter: TrackFilter;
  readonly tabs: boolean;
}) {
  const folders = useService(foldersKey);
  // 显示串里有逗号才需要补读；补读要整库曲目，没有这种曲目时不去读
  const valuesOf = useGenreValues(tracks.some((track) => track.genre.includes(', ')));
  const options = useMemo(
    () => trackFacetOptions(tracks, valuesOf ?? undefined),
    [tracks, valuesOf],
  );
  return (
    <TrackFacets
      filter={filter}
      options={options}
      onToggle={folders.results.toggleFacet}
      tabs={tabs}
    />
  );
}
