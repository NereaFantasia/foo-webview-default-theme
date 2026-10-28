import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { classifyHostHttpFailure } from '../../../host/hostHttpFailure.ts';
import { biographyFreshness, biographyRetryAt } from '../biographyCacheFormat.ts';
import {
  lastfmArtistUrl,
  type BiographyLanguage,
  type BiographyProblem,
} from '../biographyModel.ts';
import type { LastfmFetchResult } from '../fetchLastfmBiography.ts';
import { requestLastfmPage } from '../online/lastfmPageFetch.ts';
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
  const headers = (page.ok ? page.answer.headers : undefined) ?? {};
  const fail = (
    problem: BiographyProblem,
    delay: number,
    detail: string | null = null,
  ): LastfmDetailsFetchResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
    detail,
  });
  if (!page.ok)
    return fail(classifyHostHttpFailure(page.failure) ?? 'network', 30_000, page.failure.text);
  const answer = page.answer;
  if (answer.status === 429) return fail('rateLimited', 60_000);
  if (answer.status === 403) return fail('blocked', 15 * 60_000);
  if (answer.status !== 200 && answer.status !== 404) return fail('network', 30_000);
  const parsed =
    answer.status === 404
      ? { kind: 'found' as const, details: { tags: [], counters: [], similar: [], photo: null } }
      : await settle(async () =>
          parse(answer.body ?? '', artist, language, page.finalArtist ?? artist),
        );
  if (!parsed || parsed.kind === 'invalid') return fail('invalid', 5 * 60_000);
  const freshness = biographyFreshness(answer.headers ?? {}, now);
  return {
    ok: true,
    store: freshness.store,
    details: {
      ...parsed.details,
      // 归属名与链接都保持请求名：身份按它比对，缓存读回按它重建校验
      artist,
      language,
      url,
      fetchedAt: now,
      expiresAt: freshness.expiresAt,
    },
  };
}
