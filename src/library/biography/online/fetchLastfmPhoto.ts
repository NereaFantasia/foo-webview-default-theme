import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import { biographyFreshness, biographyHeader, biographyRetryAt } from '../biographyCacheFormat.ts';
import type { BiographyProblem } from '../biographyModel.ts';
import { lastfmPhotoId, type LastfmPhoto } from './lastfmPhoto.ts';

export const BIOGRAPHY_PHOTO_BYTES = 4 * 1024 * 1024;
export type BiographyPhotoProblem = BiographyProblem | 'photoMissing';
export type LastfmPhotoResult =
  | { readonly ok: true; readonly blob: Blob; readonly store: boolean; readonly expiresAt: number }
  | { readonly ok: false; readonly problem: BiographyPhotoProblem; readonly retryAt: number };

export async function fetchLastfmPhoto(
  source: LastfmPhoto,
  host: Pick<typeof fb, 'http'> = fb,
): Promise<LastfmPhotoResult> {
  if (!lastfmPhotoId(source.url))
    return { ok: false, problem: 'invalid', retryAt: Date.now() + 300_000 };
  const answer = await settle(() =>
    host.http.request(source.url, {
      responseType: 'arraybuffer',
      timeout: 12_000,
      redirect: 'error',
      headers: {
        'User-Agent': 'foo-webview-default-theme/0.1 (+https://github.com/NereaFantasia)',
        Accept: 'image/jpeg,image/png,image/webp',
      },
    }),
  );
  const now = Date.now();
  const headers = answer?.headers ?? {};
  const fail = (problem: BiographyPhotoProblem, delay: number): LastfmPhotoResult => ({
    ok: false,
    problem,
    retryAt: biographyRetryAt(headers, now, delay),
  });
  if (!answer) return fail('network', 30_000);
  if (answer.status === 429) return fail('rateLimited', 60_000);
  if (answer.status === 403) return fail('blocked', 900_000);
  if (answer.status === 404) return fail('photoMissing', 3_600_000);
  if (answer.status !== 200) return fail('network', 30_000);
  const type = biographyHeader(headers, 'content-type').split(';')[0]?.trim().toLowerCase();
  if (
    !type ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(type) ||
    !answer.body?.byteLength ||
    answer.body.byteLength > BIOGRAPHY_PHOTO_BYTES
  )
    return fail('invalid', 300_000);
  return {
    ok: true,
    blob: new Blob([answer.body], { type }),
    ...biographyFreshness(headers, now),
  };
}
