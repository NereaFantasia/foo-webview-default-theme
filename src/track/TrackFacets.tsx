import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { FacetPanel } from '../kit/FacetPanel.tsx';
import { TRACK_FACETS, type TrackFacetOptions, type TrackFacet } from './trackFacets.ts';
import type { TrackFilter } from './trackFilter.ts';
import { decadeLabel } from './filterLabels.ts';

const LABELS: Readonly<Record<TrackFacet, MessageKey>> = {
  genre: 'songs.facetGenre',
  decade: 'songs.facetDecade',
  artist: 'songs.facetArtist',
};

export interface TrackFacetsProps {
  readonly filter: TrackFilter;
  readonly options: TrackFacetOptions;
  readonly onToggle: (facet: TrackFacet, name: string) => void;
  readonly tabs?: boolean;
}

/** 曲目分面的字段与年代标签；勾选结果仍交给曲目查询模型 */
export function TrackFacets({ filter, options, onToggle, tabs }: TrackFacetsProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <FacetPanel
      label={t('songs.facets')}
      tabs={tabs}
      columns={TRACK_FACETS.map((facet) => ({
        id: facet,
        label: t(LABELS[facet]),
        selected: filter.facets[facet],
        options: options[facet].map(({ name, count }) => ({
          value: name,
          label: facet === 'decade' ? decadeLabel(name, t) : name,
          count,
        })),
      }))}
      onToggle={onToggle}
    />
  );
}
