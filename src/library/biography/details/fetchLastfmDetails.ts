import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { biographyFreshness } from '../biographyCacheFormat.ts';
import { lastfmArtistUrl, type BiographyLanguage } from '../biographyModel.ts';
import type { LastfmFetchResult } from '../fetchLastfmBiography.ts';
import { judgeLastfmPage, requestLastfmPage } from '../online/lastfmPageFetch.ts';
import type { BiographyDetails } from './biographyDetailsModel.ts';
import { readLastfmDetails } from './lastfmDetails.ts';

export type LastfmDetailsFetchResult =
  | { readonly ok: true; readonly details: BiographyDetails; readonly store: boolean }
  | Extract<LastfmFetchResult, { ok: false }>;

export async function fetchLastfmDetails(
  artist: string,
  language: BiographyLanguage,
  host: Pick<typeof fb, 'http'> = fb,
  parse: typeof readLastfmDetails = readLastfmDetails,
): Promise<LastfmDetailsFetchResult> {
  const url = lastfmArtistUrl(artist, language);
  const page = await requestLastfmPage(url, host);
  const now = Date.now();
  const verdict = judgeLastfmPage(page, now);
  if (!verdict.ok) return verdict;
  const { answer } = verdict;
  const parsed =
    answer.status === 404
      ? { kind: 'found' as const, details: { tags: [], counters: [], similar: [], photo: null } }
      : await settle(async () =>
          parse(answer.body ?? '', artist, language, verdict.finalArtist ?? artist),
        );
  if (!parsed || parsed.kind === 'invalid') return verdict.invalid;
  const freshness = biographyFreshness(answer.headers ?? {}, now);
  return {
    ok: true,
    store: freshness.store,
    details: {
      ...parsed.details,
      source: 'lastfm',
      // 归属名与链接都保持请求名：身份按它比对，缓存读回按它重建校验
      artist,
      language,
      url,
      fetchedAt: now,
      expiresAt: freshness.expiresAt,
    },
  };
}
