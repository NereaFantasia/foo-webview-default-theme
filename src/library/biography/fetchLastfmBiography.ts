import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import { biographyFreshness, biographyRetryAt } from './biographyCacheFormat.ts';
import {
  lastfmBiographyUrl,
  type BiographyCacheEntry,
  type BiographyLanguage,
  type BiographyProblem,
} from './biographyModel.ts';
import { readLastfmBiography } from './lastfmBiography.ts';

export type LastfmFetchResult =
  | { readonly ok: true; readonly entry: BiographyCacheEntry; readonly store: boolean }
  | { readonly ok: false; readonly problem: BiographyProblem; readonly retryAt: number };

export async function fetchLastfmBiography(
  artist: string,
  language: BiographyLanguage,
  host: Pick<typeof fb, 'http'> = fb,
  parse: typeof readLastfmBiography = readLastfmBiography,
): Promise<LastfmFetchResult> {
  const answer = await settle(() =>
    host.http.request(lastfmBiographyUrl(artist, language), {
      timeout: 12_000,
      redirect: 'error',
      headers: {
        'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
        Accept: 'text/html',
      },
    }),
  );
  const now = Date.now();
  const failure = (problem: BiographyProblem, delay: number): LastfmFetchResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(answer?.headers ?? {}, now, delay),
  });
  if (!answer) return failure('network', 30_000);
  if (answer.status === 429) return failure('rateLimited', 60_000);
  if (answer.status === 403) return failure('blocked', 15 * 60_000);
  if (answer.status !== 200 && answer.status !== 404) return failure('network', 30_000);
  const parsed =
    answer.status === 404
      ? { kind: 'missing' as const }
      : await settle(async () => parse(answer.body ?? '', artist, language));
  if (!parsed || parsed.kind === 'invalid') return failure('invalid', 5 * 60_000);
  const freshness = biographyFreshness(answer.headers ?? {}, now);
  return {
    ok: true,
    store: freshness.store,
    entry: {
      artist,
      language,
      fetchedAt: now,
      expiresAt: freshness.expiresAt,
      document: parsed.kind === 'found' ? parsed.document : null,
    },
  };
}
