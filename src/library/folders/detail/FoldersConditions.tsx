import { useAtomValueRawSync } from 'jotai/react';
import { playStatsAtom } from '../../playStats.ts';
import { FilterConditions } from '../../../track/FilterConditions.tsx';
import type { TrackFilter } from '../../../track/trackFilter.ts';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

export interface FoldersConditionsProps {
  readonly filter: TrackFilter;
  readonly hideWhenEmpty: boolean;
}

export function FoldersConditions({ filter, hideWhenEmpty }: FoldersConditionsProps) {
  const folders = useService(foldersKey);
  const { available } = useAtomValueRawSync(playStatsAtom);
  return (
    <FilterConditions
      filter={filter}
      playcount={available}
      hideWhenEmpty={hideWhenEmpty}
      onAdd={folders.results.addCondition}
      onClear={folders.results.clearConditions}
      onRemove={({ ref }) => {
        if (ref.kind === 'preset') folders.results.togglePreset(ref.id);
        else if (ref.kind === 'condition') folders.results.removeCondition(ref.key);
        else folders.results.toggleFacet(ref.facet, ref.name);
      }}
    />
  );
}
