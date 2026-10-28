import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import { classifyHostHttpFailure } from '../../host/hostHttpFailure.ts';
import { biographyFreshness, biographyRetryAt } from './biographyCacheFormat.ts';
import {
  lastfmBiographyUrl,
  type BiographyCacheEntry,
  type BiographyLanguage,
  type BiographyProblem,
} from './biographyModel.ts';
import { readLastfmBiography } from './lastfmBiography.ts';
import { requestLastfmPage } from './online/lastfmPageFetch.ts';

export type LastfmFetchResult =
  | { readonly ok: true; readonly entry: BiographyCacheEntry; readonly store: boolean }
  | {
      readonly ok: false;
      readonly problem: BiographyProblem;
      readonly retryAt: number;
      /** 传输或跟随跳转失败的原文；HTTP 层失败（403、429 等）没有 */
      readonly detail?: string | null;
    };

export async function fetchLastfmBiography(
  artist: string,
  language: BiographyLanguage,
  host: Pick<typeof fb, 'http'> = fb,
  parse: typeof readLastfmBiography = readLastfmBiography,
): Promise<LastfmFetchResult> {
  const page = await requestLastfmPage(lastfmBiographyUrl(artist, language), host);
  const now = Date.now();
  const headers = (page.ok ? page.answer.headers : undefined) ?? {};
  const failure = (
    problem: BiographyProblem,
    delay: number,
    detail: string | null = null,
  ): LastfmFetchResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
    detail,
  });
  if (!page.ok)
    return failure(classifyHostHttpFailure(page.failure) ?? 'network', 30_000, page.failure.text);
  const answer = page.answer;
  if (answer.status === 429) return failure('rateLimited', 60_000);
  if (answer.status === 403) return failure('blocked', 15 * 60_000);
  if (answer.status !== 200 && answer.status !== 404) return failure('network', 30_000);
  const parsed =
    answer.status === 404
      ? { kind: 'missing' as const }
      : await settle(async () =>
          parse(answer.body ?? '', artist, language, page.finalArtist ?? artist),
        );
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
