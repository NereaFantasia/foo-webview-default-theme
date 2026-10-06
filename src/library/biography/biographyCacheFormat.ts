import {
  BIOGRAPHY_DEFAULT_TTL,
  BIOGRAPHY_LANGUAGES,
  BIOGRAPHY_TEXT_LIMIT,
  biographyArtist,
  biographyLicense,
  lastfmBiographyUrl,
  type BiographyCacheEntry,
  type BiographyDocument,
} from './biographyModel.ts';
import { readBiographyDetails, readBiographyFacts } from './details/biographyDetailsModel.ts';
import { readLastfmPhotoValue } from './online/lastfmPhoto.ts';
import { readBiographyLinks } from './article/biographyLinks.ts';

/** 简介与身份两份缓存都放在 profile 下的这个目录里。 */
export const BIOGRAPHY_CACHE_DIRECTORY = 'webview-ui-artists';
export const BIOGRAPHY_CACHE_LIMIT = 64;
export const BIOGRAPHY_CACHE_BYTES = 4 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBiographyCacheEntry(value: unknown, now: number): BiographyCacheEntry | null {
  if (!record(value)) return null;
  const { artist, fetchedAt, expiresAt } = value;
  const language = BIOGRAPHY_LANGUAGES.find((item) => item === value['language']);
  if (
    typeof artist !== 'string' ||
    biographyArtist(artist) !== artist ||
    !language ||
    typeof fetchedAt !== 'number' ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt < 0 ||
    fetchedAt > now ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    expiresAt < fetchedAt ||
    expiresAt - fetchedAt > BIOGRAPHY_DEFAULT_TTL
  )
    return null;
  let document: BiographyDocument | null = null;
  if (value['document'] !== null) {
    const data = value['document'];
    if (!record(data)) return null;
    const paragraphs = data['paragraphs'];
    if (
      data['artist'] !== artist ||
      data['language'] !== language ||
      data['url'] !== lastfmBiographyUrl(artist, language) ||
      !Array.isArray(paragraphs) ||
      !paragraphs.length ||
      !paragraphs.every((item): item is string => typeof item === 'string' && !!item.trim()) ||
      paragraphs.join('\n').length > BIOGRAPHY_TEXT_LIMIT ||
      typeof data['licenseUrl'] !== 'string'
    )
      return null;
    const license = biographyLicense(data['licenseUrl']);
    if (!license) return null;
    document = {
      artist,
      language,
      paragraphs,
      ...(data['links'] === undefined
        ? {}
        : { links: readBiographyLinks(data['links'], paragraphs) }),
      url: lastfmBiographyUrl(artist, language),
      licenseUrl: license.url,
      license: license.name,
      ...(data['facts'] === undefined ? {} : { facts: readBiographyFacts(data['facts']) }),
      ...(data['photo'] === undefined
        ? {}
        : { photo: readLastfmPhotoValue(data['photo'], artist, language) }),
    };
  }
  const details = readBiographyDetails(value['details'], artist, language, now);
  return { artist, language, fetchedAt, expiresAt, document, ...(details ? { details } : {}) };
}

export function biographyHeader(headers: Readonly<Record<string, string>>, name: string): string {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}

export function biographyFreshness(
  headers: Readonly<Record<string, string>>,
  now: number,
): { readonly store: boolean; readonly expiresAt: number } {
  const control = biographyHeader(headers, 'cache-control');
  const store = !/(?:^|,)\s*no-store\b/i.test(control);
  if (!store || /(?:^|,)\s*no-cache\b/i.test(control)) return { store, expiresAt: now };
  const seconds = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control)?.[1];
  const age = Number(biographyHeader(headers, 'age')) || 0;
  const ttl = seconds === undefined ? BIOGRAPHY_DEFAULT_TTL : Number(seconds) * 1000;
  return {
    store,
    expiresAt: now + Math.max(0, Math.min(BIOGRAPHY_DEFAULT_TTL, ttl - Math.max(0, age) * 1000)),
  };
}

export function biographyRetryAt(
  headers: Readonly<Record<string, string>>,
  now: number,
  fallback: number,
): number {
  const value = biographyHeader(headers, 'retry-after').trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return now + Math.max(fallback, Number.isFinite(delay) ? delay : 0);
}
