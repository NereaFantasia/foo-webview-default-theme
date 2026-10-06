import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { biographyFreshness, biographyRetryAt } from '../biographyCacheFormat.ts';
import {
  lastfmArtistUrl,
  type BiographyLanguage,
  type BiographyProblem,
} from '../biographyModel.ts';
import type { LastfmFetchResult } from '../fetchLastfmBiography.ts';
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
  const answer = await settle(() =>
    host.http.request(url, {
      timeout: 12_000,
      redirect: 'error',
      headers: {
        'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
        Accept: 'text/html',
      },
    }),
  );
  const now = Date.now();
  const fail = (problem: BiographyProblem, delay: number): LastfmDetailsFetchResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(answer?.headers ?? {}, now, delay),
  });
  if (!answer) return fail('network', 30_000);
  if (answer.status === 429) return fail('rateLimited', 60_000);
  if (answer.status === 403) return fail('blocked', 15 * 60_000);
  if (answer.status !== 200 && answer.status !== 404) return fail('network', 30_000);
  const parsed =
    answer.status === 404
      ? { kind: 'found' as const, details: { tags: [], counters: [], similar: [], photo: null } }
      : await settle(async () => parse(answer.body ?? '', artist, language));
  if (!parsed || parsed.kind === 'invalid') return fail('invalid', 5 * 60_000);
  const freshness = biographyFreshness(answer.headers ?? {}, now);
  return {
    ok: true,
    store: freshness.store,
    details: {
      ...parsed.details,
      artist,
      language,
      url,
      fetchedAt: now,
      expiresAt: freshness.expiresAt,
    },
  };
}
