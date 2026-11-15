import {
  BIOGRAPHY_DEFAULT_TTL,
  appleAttribution,
  type ApplePhoto,
  type BiographyDocument,
  type BiographyFetchResult,
  type BiographyLanguage,
} from '../biographyModel.ts';
import type { BiographyDetails } from '../details/biographyDetailsModel.ts';
import type { AppleClient, AppleFailure } from './appleClient.ts';
import { appleFallbackPageUrl } from './appleCatalog.ts';
import { readApplePage, type AppleProfile } from './applePage.ts';

/** 认定了的那位艺人：ID 取页面，名字只在整个艺人页都取不到时用来填缓存项 */
export interface AppleSubject {
  readonly id: string;
  readonly name: string;
  /** 身份认定时记下的艺人页地址；缺省按 ID 跳转 */
  readonly url?: string;
}

/**
 * 页面地址加上 `l` 参数；cn 区只认默认语言与英文两种。英文直接写 `en-GB`：`en-US` 一律 301 到它，
 * 每多一跳宿主就多一次连接
 */
function withLanguage(url: string, tag: string): string {
  try {
    const next = new URL(url);
    next.searchParams.set('l', tag);
    return next.href;
  } catch {
    return url;
  }
}

/** 取简介依次要请求的页面地址；`fallback` 为真是默认语言的页面刚取过、没有简介，只剩英文那一份 */
function pageUrls(
  subject: AppleSubject,
  language: BiographyLanguage,
  fallback: boolean,
): readonly string[] {
  const base = subject.url ?? appleFallbackPageUrl(subject.id);
  const english = withLanguage(base, 'en-GB');
  return language === 'zh' ? [base] : fallback ? [english] : [english, base];
}

/**
 * 取这位艺人的简介时第一个请求的页面地址。认定期间据此提前取页（`AppleClient.prefetch`），地址要和
 * `fetchAppleBiography` 实际请求的一字不差，提前取的结果才对得上
 */
export function appleFirstPageUrl(subject: AppleSubject, language: BiographyLanguage): string {
  return pageUrls(subject, language, false)[0] ?? appleFallbackPageUrl(subject.id);
}

function failed(failure: AppleFailure): BiographyFetchResult {
  return {
    ok: false,
    problem: failure.problem,
    retryAt: failure.retryAt,
    detail: failure.detail ?? null,
  };
}

function entryOf(
  subject: AppleSubject,
  language: BiographyLanguage,
  profile: AppleProfile | null,
  now: number,
): BiographyFetchResult {
  const expiresAt = now + BIOGRAPHY_DEFAULT_TTL;
  const base = {
    source: 'apple',
    sourceId: subject.id,
    language,
    fetchedAt: now,
    expiresAt,
  } as const;
  if (!profile)
    return {
      ok: true,
      store: true,
      entry: { ...base, artist: subject.name.normalize('NFC').trim(), document: null },
    };
  // JSON-LD 没有艺术照而页面有宽幅图时，艺术照也取宽幅图的基础地址
  const image = profile.image ?? profile.wide?.url ?? null;
  const photo: ApplePhoto | null = image
    ? {
        source: 'apple',
        url: image,
        pageUrl: profile.url,
        ...(profile.wide ? { wide: profile.wide } : {}),
      }
    : null;
  const document: BiographyDocument | null =
    profile.paragraphs.length && profile.textLanguage
      ? {
          source: 'apple',
          sourceId: subject.id,
          artist: profile.name,
          language,
          textLanguage: profile.textLanguage,
          paragraphs: profile.paragraphs,
          url: profile.url,
          attribution: appleAttribution(profile.url),
          ...(photo ? { photo } : {}),
          ...(profile.logo ? { logo: profile.logo } : {}),
          ...(profile.motion ? { motion: profile.motion } : {}),
        }
      : null;
  // 曲风、艺术照与正文来自同一页，随正文一起交出，服务不必为 Apple 再取一次附加资料
  const details: BiographyDetails = {
    source: 'apple',
    artist: profile.name,
    language,
    url: profile.url,
    fetchedAt: now,
    expiresAt,
    tags: profile.genres,
    counters: [],
    similar: [],
    ...(photo ? { photo } : {}),
  };
  return { ok: true, store: true, entry: { ...base, artist: profile.name, document, details } };
}

/**
 * 取一位 Apple 艺人的简介。`zh` 取默认语言的页面；`en` 先取 `?l=en-GB`，没有真简介再取默认语言
 * 的页面（可能是原文，如日文）。取到第一份有真简介的就停，都没有时简介记为没有，页面里的
 * 曲风和艺术照仍交出。`zh` 没有简介时服务会改取 `en`，回退链不在这里重写；`fallback` 为真就是
 * 这种回落，默认语言的页面刚取过、没有简介，不再取第二遍
 *
 * 缓存有效期固定 28 天，不照响应头：Apple 艺人页回 `max-age=60`，照办会每次查看都重抓 700 KB
 */
export async function fetchAppleBiography(
  client: Pick<AppleClient, 'page'>,
  subject: AppleSubject,
  language: BiographyLanguage,
  fallback = false,
  alive: () => boolean = () => true,
): Promise<BiographyFetchResult> {
  let first: AppleProfile | null = null;
  for (const url of pageUrls(subject, language, fallback)) {
    const answer = await client.page(url, alive);
    if (answer.kind === 'failed') return failed(answer);
    if (answer.kind === 'missing') continue;
    const read = readApplePage(answer.html, subject.id);
    if (read.kind === 'invalid')
      return failed({
        kind: 'failed',
        problem: 'invalid',
        retryAt: Date.now() + 5 * 60_000,
        detail: null,
      });
    first ??= read.profile;
    if (read.profile.paragraphs.length) return entryOf(subject, language, read.profile, Date.now());
  }
  return entryOf(subject, language, first, Date.now());
}
