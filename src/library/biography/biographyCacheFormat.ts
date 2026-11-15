import { appleArtistId, appleArtistPageUrl } from './apple/appleCatalog.ts';
import { readAppleLogo, readApplePhoto, readAppleMotion } from './apple/appleMedia.ts';
import { stripAppleMarkup } from './apple/applePage.ts';
import {
  BIOGRAPHY_DEFAULT_TTL,
  BIOGRAPHY_LANGUAGES,
  BIOGRAPHY_TEXT_LANGUAGES,
  BIOGRAPHY_TEXT_LIMIT,
  appleAttribution,
  biographyArtist,
  biographyLicense,
  lastfmAttribution,
  lastfmBiographyUrl,
  type BiographyCacheEntry,
  type BiographyDocument,
  type BiographyLanguage,
  type BiographySource,
} from './biographyModel.ts';
import {
  biographyField,
  readBiographyDetails,
  readBiographyFacts,
} from './details/biographyDetailsModel.ts';
import { readLastfmPhotoValue } from './online/lastfmPhoto.ts';
import { readBiographyLinks } from './article/biographyLinks.ts';

/** 简介与身份两份缓存都放在 profile 下的这个目录里 */
export const BIOGRAPHY_CACHE_DIRECTORY = 'webview-ui-artists';
export const BIOGRAPHY_CACHE_LIMIT = 64;
export const BIOGRAPHY_CACHE_BYTES = 4 * 1024 * 1024;
/** 每个来源各存一个文件，键不会互相覆盖；格式重大调整时换带版本号的新文件名 */
export const BIOGRAPHY_CACHE_FILES: Readonly<Record<BiographySource, string>> = {
  lastfm: 'lastfm-v1.json',
  apple: 'apple-v1.json',
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Apple 的艺人名只做显示，不像 Last.fm 的名字要拼进地址，所以不排除合辑名之类 */
function appleName(value: unknown): value is string {
  return biographyField(value, 200) && value === value.normalize('NFC').trim();
}

/** 文档里各来源都一样的部分；不合格答 null */
function readParagraphs(data: Record<string, unknown>): string[] | null {
  const paragraphs = data['paragraphs'];
  return Array.isArray(paragraphs) &&
    paragraphs.length &&
    paragraphs.every((item): item is string => typeof item === 'string' && !!item.trim()) &&
    paragraphs.join('\n').length <= BIOGRAPHY_TEXT_LIMIT
    ? paragraphs
    : null;
}

function readLastfmDocument(
  data: Record<string, unknown>,
  artist: string,
  language: BiographyLanguage,
  paragraphs: string[],
): BiographyDocument | null {
  if (data['url'] !== lastfmBiographyUrl(artist, language)) return null;
  const license =
    typeof data['licenseUrl'] === 'string' ? biographyLicense(data['licenseUrl']) : null;
  if (!license) return null;
  return {
    source: 'lastfm',
    sourceId: artist,
    artist,
    language,
    paragraphs,
    ...(data['links'] === undefined
      ? {}
      : { links: readBiographyLinks(data['links'], paragraphs) }),
    url: lastfmBiographyUrl(artist, language),
    attribution: lastfmAttribution(artist, language, license),
    licenseUrl: license.url,
    license: license.name,
    ...(data['facts'] === undefined ? {} : { facts: readBiographyFacts(data['facts']) }),
    ...(data['photo'] === undefined
      ? {}
      : { photo: readLastfmPhotoValue(data['photo'], artist, language) }),
  };
}

function readAppleDocument(
  data: Record<string, unknown>,
  sourceId: string,
  artist: string,
  language: BiographyLanguage,
  paragraphs: string[],
): BiographyDocument | null {
  const url = appleArtistPageUrl(data['url'], sourceId);
  // 早先存下的英文简介带着 `<i>` 标记，读回时同样去掉，免得缓存没过期的几周里还露标签
  const clean = paragraphs.map(stripAppleMarkup).filter((paragraph) => paragraph.trim());
  if (!url || !clean.length) return null;
  const textLanguage = BIOGRAPHY_TEXT_LANGUAGES.find((item) => item === data['textLanguage']);
  const logo = readAppleLogo(data['logo']);
  const motion = readAppleMotion(data['motion']);
  return {
    source: 'apple',
    sourceId,
    artist,
    language,
    ...(textLanguage ? { textLanguage } : {}),
    paragraphs: clean,
    url,
    attribution: appleAttribution(url),
    ...(data['photo'] === undefined ? {} : { photo: readApplePhoto(data['photo'], url) }),
    ...(logo ? { logo } : {}),
    ...(motion ? { motion } : {}),
  };
}

/**
 * 读回某个来源的缓存项，不合格的答 null。署名、地址在这里按来源重建，不信文件里的值；
 * 没有 `source`、`sourceId` 的旧项照读：Last.fm 的身份就是艺人名
 */
function readerOf(source: BiographySource) {
  return (value: unknown, now: number): BiographyCacheEntry | null => {
    if (!record(value)) return null;
    const { artist, fetchedAt, expiresAt } = value;
    const language = BIOGRAPHY_LANGUAGES.find((item) => item === value['language']);
    const apple = source === 'apple';
    const sourceId = apple ? appleArtistId(value['sourceId']) : artist;
    if (
      typeof artist !== 'string' ||
      typeof sourceId !== 'string' ||
      !(apple ? appleName(artist) : biographyArtist(artist) === artist) ||
      (value['source'] !== undefined && value['source'] !== source) ||
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
      const paragraphs = record(data) ? readParagraphs(data) : null;
      if (
        !record(data) ||
        !paragraphs ||
        data['artist'] !== artist ||
        data['language'] !== language
      )
        return null;
      document = apple
        ? readAppleDocument(data, sourceId, artist, language, paragraphs)
        : readLastfmDocument(data, artist, language, paragraphs);
      if (!document) return null;
    }
    const details = readBiographyDetails(value['details'], artist, language, now, {
      source,
      id: sourceId,
    });
    return {
      source,
      sourceId,
      artist,
      language,
      fetchedAt,
      expiresAt,
      document,
      ...(details ? { details } : {}),
    };
  };
}

export const readBiographyCacheEntry = readerOf('lastfm');
export const readAppleCacheEntry = readerOf('apple');

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
