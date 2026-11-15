import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { useService } from '../../kit/useService.ts';
import { TrackFacets } from '../../track/TrackFacets.tsx';
import type { TrackFilter } from '../../track/trackFilter.ts';
import { playlistPageKey } from '../playlistPageServices.ts';
import { PLAYLIST_FACETS } from './playlistFacets.ts';

/**
 * 筛选面板里的分面：流派、年代、艺人三栏，取值是这张列表自己的（宿主按游程数出来），勾选进筛选。只在面板
 * 显示时挂上，这时才向宿主取；取不到、列表太大时整块不出
 */
export function PlaylistFacets({
  guid,
  filter,
  tabs,
}: {
  readonly guid: string;
  readonly filter: TrackFilter;
  readonly tabs: boolean;
}) {
  const page = useService(playlistPageKey);
  useEffect(() => page.facets.acquire(guid), [page, guid]);
  const { status, options } = useAtomValueRawSync(page.facets.stateOf(guid));
  if (status === 'unavailable' || options === null) return null;
  return (
    <TrackFacets
      filter={filter}
      options={options}
      onToggle={(facet, name) => page.filter.toggleFacet(guid, facet, name)}
      tabs={tabs}
      facets={PLAYLIST_FACETS}
    />
  );
}
