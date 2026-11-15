import type { LibraryTrack } from 'foo-webview-sdk';
import type { Answer, HostParams, HostResponse } from './fakeHost.ts';
import { numberParam, stringParam } from './hostAnswers.ts';

// 整库曲目的 `library.search` 应答：页面用 ALL 查询按页取整库，这里把一份曲目按 offset、limit 切成页

function page(tracks: readonly LibraryTrack[], params: HostParams): HostResponse<'library.search'> {
  const offset = numberParam(params, 'offset') ?? 0;
  const limit = numberParam(params, 'limit') ?? 100;
  const rows = tracks.slice(offset, offset + limit);
  return {
    success: true,
    tracks: rows,
    total: tracks.length,
    offset,
    limit,
    hasMore: offset + rows.length < tracks.length,
  };
}

/** ALL 查询答 `tracks` 的一页；别的查询交给 `other`，没给就答没有命中 */
export function wholeLibrary(
  tracks: readonly LibraryTrack[],
  other?: Answer<'library.search'>,
): Answer<'library.search'> {
  return (params) => {
    if (stringParam(params, 'query') === 'ALL') return page(tracks, params);
    if (typeof other === 'function') return other(params);
    return other ?? page([], params);
  };
}
