import { isCompilation } from '../artists/artistNames.ts';
import type { BiographyDetails, BiographyFact } from './details/biographyDetailsModel.ts';
import type { LastfmPhoto } from './online/lastfmPhoto.ts';
import type { BiographyTextLink } from './article/biographyLinks.ts';

export const BIOGRAPHY_LANGUAGES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'pl',
  'pt',
  'ru',
  'sv',
  'tr',
  'zh',
] as const;
export type BiographyLanguage = (typeof BIOGRAPHY_LANGUAGES)[number];
export type BiographyLanguagePreference = 'auto' | BiographyLanguage;

export function biographyLanguage(tag: string): BiographyLanguage {
  try {
    const language = new Intl.Locale(tag).language;
    return BIOGRAPHY_LANGUAGES.find((item) => item === language) ?? 'en';
  } catch {
    return 'en';
  }
}

export interface BiographyIdentity {
  readonly artist: string;
  readonly sourceArtist: string;
  /** 从 MusicBrainz 候选里选的才有；粘贴 Last.fm 链接确认的没有。 */
  readonly mbid?: string;
}

export interface BiographyInput {
  readonly artist: string;
  /** 只有已确认的来源身份才填值，未确认时为 null。 */
  readonly sourceArtist: string | null;
  readonly language: BiographyLanguage;
}

export interface BiographyDocument {
  readonly artist: string;
  readonly language: BiographyLanguage;
  readonly paragraphs: readonly string[];
  readonly links?: readonly BiographyTextLink[];
  readonly url: string;
  readonly licenseUrl: string;
  readonly license: string;
  readonly facts?: readonly BiographyFact[];
  readonly photo?: LastfmPhoto | null;
}

export interface BiographyCacheEntry {
  readonly artist: string;
  readonly language: BiographyLanguage;
  readonly fetchedAt: number;
  readonly expiresAt: number;
  readonly document: BiographyDocument | null;
  readonly details?: BiographyDetails;
}

/** keyInvalid、keySuspended 只来自 Last.fm API：key 无效或被停用。 */
export type BiographyProblem =
  'network' | 'blocked' | 'rateLimited' | 'invalid' | 'keyInvalid' | 'keySuspended';

export interface BiographyState {
  readonly status:
    'disabled' | 'idle' | 'unconfirmed' | 'loading' | 'ready' | 'missing' | 'error' | 'cleared';
  readonly document: BiographyDocument | null;
  readonly refreshing: boolean;
  readonly stale: boolean;
  readonly problem: BiographyProblem | null;
  readonly cacheFailed: boolean;
  readonly details?: BiographyDetails | null;
  readonly detailsLoading?: boolean;
  readonly detailsProblem?: BiographyProblem | null;
}

export const BIOGRAPHY_TEXT_LIMIT = 64_000;
export const BIOGRAPHY_DEFAULT_TTL = 28 * 24 * 60 * 60 * 1000;

export function biographyArtist(value: string): string | null {
  const name = value.normalize('NFC').trim();
  if (!name || name === '.' || name === '..' || name.length > 200 || /[\p{Cc}]/u.test(name))
    return null;
  return isCompilation(name) ? null : name;
}

export function biographyKey(artist: string, language: BiographyLanguage): string {
  return JSON.stringify([artist, language]);
}

export function lastfmBiographyUrl(artist: string, language: BiographyLanguage): string {
  const prefix = language === 'en' ? '' : `/${language}`;
  return `https://www.last.fm${prefix}/music/${encodeURIComponent(artist)}/+wiki`;
}

export function lastfmArtistUrl(artist: string, language: BiographyLanguage): string {
  return lastfmBiographyUrl(artist, language).replace(/\/\+wiki$/, '');
}

export function lastfmArtistFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !['www.last.fm', 'last.fm'].includes(url.hostname)
    )
      return null;
    // 有简繁两个条目或改过名的艺人，Last.fm 链到另一个名字时带 `+noredirect/`，仍是这个名字的页面。
    const match = /^\/(?:[a-z]{2}\/)?music\/(?:\+noredirect\/)?([^/]+)(?:\/\+wiki)?\/?$/.exec(
      url.pathname,
    );
    return match?.[1] ? biographyArtist(decodeURIComponent(match[1].replace(/\+/g, ' '))) : null;
  } catch {
    return null;
  }
}

export function biographyLicense(value: string): { url: string; name: string } | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      return null;
    if (!['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname)) return null;
    const match = /^\/licenses\/by-sa\/(3\.0|4\.0)\/(?:legalcode(?:\.[a-z-]+)?)?$/.exec(
      url.pathname,
    );
    return match
      ? {
          url: `https://creativecommons.org/licenses/by-sa/${match[1]}/`,
          name: `CC BY-SA ${match[1]}`,
        }
      : null;
  } catch {
    return null;
  }
}
