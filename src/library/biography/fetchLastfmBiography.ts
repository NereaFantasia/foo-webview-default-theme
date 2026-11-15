import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../host/hostCall.ts';
import { biographyFreshness } from './biographyCacheFormat.ts';
import {
  lastfmBiographyUrl,
  type BiographyFetchResult,
  type BiographyLanguage,
} from './biographyModel.ts';
import { readLastfmBiography } from './lastfmBiography.ts';
import { judgeLastfmPage, requestLastfmPage } from './online/lastfmPageFetch.ts';

export type LastfmFetchResult = BiographyFetchResult;

export async function fetchLastfmBiography(
  artist: string,
  language: BiographyLanguage,
  host: Pick<typeof fb, 'http'> = fb,
  parse: typeof readLastfmBiography = readLastfmBiography,
): Promise<LastfmFetchResult> {
  const page = await requestLastfmPage(lastfmBiographyUrl(artist, language), host);
  const now = Date.now();
  const verdict = judgeLastfmPage(page, now);
  if (!verdict.ok) return verdict;
  const { answer } = verdict;
  const parsed =
    answer.status === 404
      ? { kind: 'missing' as const }
      : await settle(async () =>
          parse(answer.body ?? '', artist, language, verdict.finalArtist ?? artist),
        );
  if (!parsed || parsed.kind === 'invalid') return verdict.invalid;
  const freshness = biographyFreshness(answer.headers ?? {}, now);
  return {
    ok: true,
    store: freshness.store,
    entry: {
      source: 'lastfm',
      sourceId: artist,
      artist,
      language,
      fetchedAt: now,
      expiresAt: freshness.expiresAt,
      document: parsed.kind === 'found' ? parsed.document : null,
    },
  };
}
