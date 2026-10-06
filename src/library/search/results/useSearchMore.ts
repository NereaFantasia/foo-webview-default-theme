import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef } from 'react';
import type { SearchResultsService } from '../searchResults.ts';

export function useSearchMore(
  results: SearchResultsService,
  scroller: HTMLElement | null,
  enabled: boolean,
) {
  const sentinel = useRef<HTMLDivElement>(null);
  const state = useAtomValueRawSync(results.state);
  useEffect(() => {
    const target = sentinel.current;
    if (
      !target ||
      !scroller ||
      !enabled ||
      state.status !== 'ready' ||
      state.loadingMore ||
      state.moreFailed ||
      state.limited ||
      state.total === null ||
      state.tracks.length >= state.total
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void results.more();
      },
      { root: scroller, rootMargin: '0px 0px 280px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [results, scroller, enabled, state]);
  return sentinel;
}
