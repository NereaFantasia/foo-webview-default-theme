import { useAtomValueRawSync } from 'jotai/react';
import { playStatsAtom } from '../playStats.ts';
import { FilterConditions } from '../../track/FilterConditions.tsx';
import type { TrackFilter } from '../../track/trackFilter.ts';
import { useService } from '../../kit/useService.ts';
import { songsKey } from './songsServices.ts';

export function SongsConditions({
  filter,
  hideWhenEmpty,
}: {
  readonly filter: TrackFilter;
  readonly hideWhenEmpty: boolean;
}) {
  const songs = useService(songsKey);
  const { available } = useAtomValueRawSync(playStatsAtom);
  return (
    <FilterConditions
      filter={filter}
      playcount={available}
      hideWhenEmpty={hideWhenEmpty}
      onAdd={songs.filter.addCondition}
      onClear={songs.filter.clearConditions}
      onRemove={({ ref }) => {
        if (ref.kind === 'preset') songs.filter.togglePreset(ref.id);
        else if (ref.kind === 'condition') songs.filter.removeCondition(ref.key);
        else songs.filter.toggleFacet(ref.facet, ref.name);
      }}
    />
  );
}
