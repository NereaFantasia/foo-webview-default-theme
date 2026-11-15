import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { FacetPanel } from '../kit/FacetPanel.tsx';
import { TRACK_FACETS, type TrackFacetOptions, type TrackFacet } from './trackFacets.ts';
import type { TrackFilter } from './trackFilter.ts';
import { facetValueLabel } from './filterLabels.ts';

const LABELS: Readonly<Record<TrackFacet, MessageKey>> = {
  genre: 'songs.facetGenre',
  decade: 'songs.facetDecade',
  artist: 'songs.facetArtist',
  album: 'songs.facetAlbum',
};

export interface TrackFacetsProps {
  readonly filter: TrackFilter;
  readonly options: TrackFacetOptions;
  readonly onToggle: (facet: TrackFacet, name: string) => void;
  readonly tabs?: boolean;
  /** 要列哪几栏，缺省全列；取值只数得出其中几栏的来源只列那几栏 */
  readonly facets?: readonly TrackFacet[];
}

/** 曲目分面的字段与取值标签；勾选结果仍交给曲目查询模型 */
export function TrackFacets({
  filter,
  options,
  onToggle,
  tabs,
  facets = TRACK_FACETS,
}: TrackFacetsProps) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <FacetPanel
      label={t('songs.facets')}
      tabs={tabs}
      columns={facets.map((facet) => ({
        id: facet,
        label: t(LABELS[facet]),
        selected: filter.facets[facet],
        options: options[facet].map(({ name, count, label }) => ({
          value: name,
          label: label ?? facetValueLabel(facet, name, t),
          count,
        })),
      }))}
      onToggle={onToggle}
    />
  );
}
