import { isCompilation } from '../artists/artistNames.ts';
import type { BiographyDetails, BiographyFact } from './details/biographyDetailsModel.ts';
import { appleArtistId } from './apple/appleCatalog.ts';
import type { AppleImageRequest, AppleLogo, AppleMotion, AppleWide } from './apple/appleMedia.ts';
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
  /** 从 MusicBrainz 候选里选的才有；粘贴 Last.fm 链接确认的没有 */
  readonly mbid?: string;
}

export interface BiographyInput {
  readonly artist: string;
  readonly source: BiographySource;
  /** 来源里的身份：Last.fm 等于 `sourceArtist`，Apple 是艺人 ID。只有已确认的才填值，未确认时为 null */
  readonly sourceId: string | null;
  /** 来源给的艺人名，用于显示 */
  readonly sourceArtist: string | null;
  /** 身份认定时记下的来源页地址（Apple 取简介直接用，省掉按 ID 跳转）；没有就不写 */
  readonly sourceUrl?: string;
  readonly language: BiographyLanguage;
}

/** Last.fm 来源的输入：身份就是艺人名，没确认时三项都为空 */
export function lastfmInput(
  artist: string,
  sourceArtist: string | null,
  language: BiographyLanguage,
): BiographyInput {
  return { artist, source: 'lastfm', sourceId: sourceArtist, sourceArtist, language };
}

/** 交给取数函数的身份：来源、来源里的 id、显示名，有页面地址时一并给 */
export interface BiographyFetchSubject extends BiographySubject {
  readonly name: string;
  readonly url?: string;
}

/** 来源里的 id 合不合格：Last.fm 的 id 是要拼进地址的艺人名，Apple 的是数字串 */
export function isBiographyId(source: BiographySource, id: string): boolean {
  return source === 'apple' ? appleArtistId(id) !== null : biographyArtist(id) !== null;
}

export type BiographySource = 'lastfm' | 'apple';

/** 简介文字实际用的语言；`ko` 不在可选的简介语言里，所以单列 */
export type BiographyTextLanguage = 'en' | 'ja' | 'zh' | 'ko';
export const BIOGRAPHY_TEXT_LANGUAGES: readonly BiographyTextLanguage[] = ['en', 'ja', 'zh', 'ko'];

/**
 * 一位艺人在某个来源里的身份。Last.fm 的 `id` 是艺人名，Apple 的是艺人 ID（数字串）；
 * 缓存按它存取，同名的两位艺人 ID 不同，互不覆盖
 */
export interface BiographySubject {
  readonly source: BiographySource;
  readonly id: string;
}

/** 来源行读它：出处名链回来源页，有许可时另列许可。读回缓存时按来源重建，不信文件里的值 */
export interface BiographyAttribution {
  readonly name: string;
  readonly url: string;
  readonly license?: { readonly name: string; readonly url: string };
}

/** Apple 的艺术照：`url` 是不含尺寸与格式的基础地址，按显示尺寸拼出取图地址 */
export interface ApplePhoto {
  readonly source: 'apple';
  readonly url: string;
  readonly pageUrl: string;
  /** 艺人页头部要铺满的宽幅图，只有部分艺人有 */
  readonly wide?: AppleWide;
  /** 取图的尺寸与裁切，缺省取 600 见方的整图。只在内存里用，不进缓存 */
  readonly request?: AppleImageRequest;
}

/** Last.fm 的照片没有 `source`（旧缓存的写法），Apple 的带 `source: 'apple'`，据此区分 */
export type BiographyPhoto = LastfmPhoto | ApplePhoto;

export interface BiographyDocument {
  readonly source: BiographySource;
  /** 来源里的身份：Last.fm 等于 `artist`，Apple 是艺人 ID */
  readonly sourceId: string;
  /** 来源给的艺人名，用于显示 */
  readonly artist: string;
  /** 请求的语言，是缓存键的一部分 */
  readonly language: BiographyLanguage;
  /** 文字实际用的语言，只有 Apple 来源填；界面的 `lang` 属性用它，缺省按 `language` */
  readonly textLanguage?: BiographyTextLanguage;
  readonly paragraphs: readonly string[];
  readonly links?: readonly BiographyTextLink[];
  readonly url: string;
  readonly attribution: BiographyAttribution;
  /** 只有 Last.fm 来源填：保留给回滚的旧版本读，来源行读 `attribution` */
  readonly licenseUrl?: string;
  readonly license?: string;
  readonly facts?: readonly BiographyFact[];
  readonly photo?: BiographyPhoto | null;
  /** 只有部分 Apple 艺人有 */
  readonly logo?: AppleLogo;
  readonly motion?: AppleMotion;
}

/** 取正文的结果，各来源一样：成功时带缓存项和能不能存，失败时带归类、不早于何时重试和宿主原文 */
export type BiographyFetchResult =
  | { readonly ok: true; readonly entry: BiographyCacheEntry; readonly store: boolean }
  | {
      readonly ok: false;
      readonly problem: BiographyProblem;
      readonly retryAt: number;
      /** 传输或跟随跳转失败的原文；HTTP 层失败（403、429 等）没有 */
      readonly detail?: string | null;
    };

export interface BiographyCacheEntry {
  readonly source: BiographySource;
  readonly sourceId: string;
  readonly artist: string;
  readonly language: BiographyLanguage;
  readonly fetchedAt: number;
  readonly expiresAt: number;
  readonly document: BiographyDocument | null;
  readonly details?: BiographyDetails;
}

/**
 * keyInvalid、keySuspended 只来自 Last.fm API：key 无效或被停用
 * dns、localRelay 是宿主 http 失败的细分（host/hostHttpFailure.ts 的归类）
 */
export type BiographyProblem =
  | 'network'
  | 'dns'
  | 'localRelay'
  | 'blocked'
  | 'rateLimited'
  | 'invalid'
  | 'keyInvalid'
  | 'keySuspended';

export interface BiographyState {
  readonly status:
    'disabled' | 'idle' | 'unconfirmed' | 'loading' | 'ready' | 'missing' | 'error' | 'cleared';
  readonly document: BiographyDocument | null;
  readonly refreshing: boolean;
  readonly stale: boolean;
  readonly problem: BiographyProblem | null;
  /** problem 的宿主失败原文，只在内存里给界面诊断用 */
  readonly problemDetail?: string | null;
  readonly cacheFailed: boolean;
  readonly details?: BiographyDetails | null;
  readonly detailsLoading?: boolean;
  readonly detailsProblem?: BiographyProblem | null;
  readonly detailsProblemDetail?: string | null;
  /** 界面语言那一份没有正文、改取英文期间先交出的主图；这一轮结束后由正文与资料里的主图接替 */
  readonly photo?: BiographyPhoto | null;
  /** Apple 没有简介、改用 Last.fm 补正文时，Last.fm 那边取失败的原因 */
  readonly fallbackProblem?: BiographyProblem | null;
}

export const BIOGRAPHY_TEXT_LIMIT = 64_000;
export const BIOGRAPHY_DEFAULT_TTL = 28 * 24 * 60 * 60 * 1000;

export function biographyArtist(value: string): string | null {
  const name = value.normalize('NFC').trim();
  if (!name || name === '.' || name === '..' || name.length > 200 || /[\p{Cc}]/u.test(name))
    return null;
  return isCompilation(name) ? null : name;
}

/** 缓存键；`id` 是来源里的身份（Last.fm 的艺人名、Apple 的艺人 ID），每个来源各有一份缓存 */
export function biographyKey(id: string, language: BiographyLanguage): string {
  return JSON.stringify([id, language]);
}

/** Last.fm 来源的署名：出处链回 +wiki 页，许可是 CC BY-SA */
export function lastfmAttribution(
  artist: string,
  language: BiographyLanguage,
  license: { readonly name: string; readonly url: string },
): BiographyAttribution {
  return { name: 'Last.fm', url: lastfmBiographyUrl(artist, language), license };
}

/** Apple 来源的署名：Apple 的编辑内容没有开放许可，只写出处并链回艺人页 */
export function appleAttribution(url: string): BiographyAttribution {
  return { name: 'Apple Music', url };
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
    // 有简繁两个条目或改过名的艺人，Last.fm 链到另一个名字时带 `+noredirect/`，仍是这个名字的页面
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
