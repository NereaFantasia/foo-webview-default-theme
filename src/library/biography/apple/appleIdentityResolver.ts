import { IDENTITY_OPEN_TTL, IDENTITY_RESOLVED_TTL } from '../identity/identityRecord.ts';
import {
  appleArtistId,
  readAppleAlbums,
  readAppleSearch,
  type AppleArtistHit,
} from './appleCatalog.ts';
import type { AppleClient, AppleFailure, AppleLanguage } from './appleClient.ts';
import type { AppleIdentityRecord } from './appleIdentityRecord.ts';
import {
  APPLE_CANDIDATE_LIMIT,
  decideAppleIdentity,
  listAppleCandidates,
  scoreAppleCandidates,
  selectAppleCandidates,
  uniqueNamedHit,
  type AppleCandidate,
  type LocalAlbum,
} from './appleMatch.ts';

export type AppleIdentityOutcome =
  | { readonly kind: 'record'; readonly entry: AppleIdentityRecord }
  | AppleFailure
  | { readonly kind: 'cancelled' };

/**
 * 按艺人名认定本地艺人是 Apple 上的哪一位：一次搜索加一次批量 Lookup，在本机与本地专辑比对，
 * 按 `decideAppleIdentity` 认定或列出候选。`compare` 为 false（用户说过「不是这位」）时只列名字
 * 一致的，不比对专辑，记录带 `rejected`，读回时不再重新判定。请求里只有艺人名与艺人 ID，不外发
 * 本地专辑名；有候选时总会 Lookup，候选行要靠专辑名和年份认人，没有本地专辑也一样。搜索结果里名字
 * 一致的只有一位时，在 Lookup 之前先交给 `prefetch`，调用方趁认定还在比对时去取他的艺人页
 */
export async function resolveAppleIdentity(
  client: Pick<AppleClient, 'search' | 'lookup'>,
  artist: string,
  albums: readonly LocalAlbum[],
  compare: boolean,
  alive: () => boolean,
  prefetch?: (hit: AppleArtistHit, alive: () => boolean) => void,
  language?: AppleLanguage,
): Promise<AppleIdentityOutcome> {
  const found = await client.search(artist, alive, language);
  if (!alive()) return { kind: 'cancelled' };
  if (found.kind === 'failed') return found;
  const all = readAppleSearch(found.data);
  // 名字一致的只有一位时多半就是他：Lookup 还在路上，先去取他的艺人页
  const sole = compare ? uniqueNamedHit(artist, all) : null;
  if (sole) prefetch?.(sole, alive);
  const hits = selectAppleCandidates(artist, all);
  const now = Date.now();
  const open = { artist, fetchedAt: now, expiresAt: now + IDENTITY_OPEN_TTL };
  if (!hits.length) return { kind: 'record', entry: { ...open, status: 'none' } };
  const looked = await client.lookup(
    hits.map((hit) => hit.id),
    alive,
  );
  if (!alive()) return { kind: 'cancelled' };
  if (looked.kind === 'failed') return looked;
  const scored = scoreAppleCandidates(
    artist,
    hits,
    readAppleAlbums(looked.data),
    compare ? albums : [],
  );
  const decision = decideAppleIdentity(scored, { allowAuto: compare, localCount: albums.length });
  if (decision.kind === 'none') return { kind: 'record', entry: { ...open, status: 'none' } };
  if (decision.kind === 'ambiguous')
    return {
      kind: 'record',
      entry: {
        ...open,
        status: 'ambiguous',
        candidates: decision.candidates,
        ...(compare ? {} : { rejected: true as const }),
      },
    };
  const { id, name, url } = decision.candidate;
  return {
    kind: 'record',
    entry: {
      ...open,
      expiresAt: now + IDENTITY_RESOLVED_TTL,
      status: 'resolved',
      sourceId: id,
      sourceArtist: name,
      url,
      candidates: listAppleCandidates(scored),
    },
  };
}

export type AppleSearchOutcome =
  | { readonly kind: 'found'; readonly candidates: readonly AppleCandidate[] }
  | AppleFailure
  | { readonly kind: 'cancelled' };

/**
 * 用户在搜索框里输入关键词找艺人：一次搜索加一次批量 Lookup，共 2 个请求，发出去的只有关键词与
 * 艺人 ID。手动搜的不与本地专辑比对，所以不过滤候选（`listAppleCandidates` 会按名字与重合筛掉），
 * 按 Apple 返回的次序取前 8 位；Lookup 只为让候选行有专辑名与年份可认人
 */
export async function searchAppleArtists(
  client: Pick<AppleClient, 'search' | 'lookup'>,
  term: string,
  alive: () => boolean,
  language?: AppleLanguage,
): Promise<AppleSearchOutcome> {
  const found = await client.search(term, alive, language);
  if (!alive()) return { kind: 'cancelled' };
  if (found.kind === 'failed') return found;
  const hits = readAppleSearch(found.data).slice(0, APPLE_CANDIDATE_LIMIT);
  if (!hits.length) return { kind: 'found', candidates: [] };
  const looked = await client.lookup(
    hits.map((hit) => hit.id),
    alive,
  );
  if (!alive()) return { kind: 'cancelled' };
  if (looked.kind === 'failed') return looked;
  return {
    kind: 'found',
    candidates: scoreAppleCandidates(term, hits, readAppleAlbums(looked.data), []),
  };
}

/** 从粘贴的链接里取出 Apple 艺人 ID；不是 music.apple.com 或 itunes.apple.com 的艺人页答 null */
export function appleArtistIdFromLink(link: string): string | null {
  try {
    const url = new URL(link.trim());
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !['music.apple.com', 'itunes.apple.com'].includes(url.hostname)
    )
      return null;
    const match = /^\/(?:[a-z]{2}\/)?artist\/(?:[^/]+\/)?(\d+)\/?$/.exec(url.pathname);
    return appleArtistId(match?.[1]);
  } catch {
    return null;
  }
}

export type AppleLinkOutcome =
  | {
      readonly kind: 'found';
      readonly sourceId: string;
      readonly sourceArtist: string;
      readonly url: string;
    }
  | { readonly kind: 'missing' }
  | AppleFailure
  | { readonly kind: 'cancelled' };

/**
 * 粘贴 Apple 艺人链接是精确选择，不受同名影响：按链接里的 ID 做一次 Lookup 取名字和规范地址
 * 只做一次请求，不跟随页面跳转
 */
export async function resolveAppleLink(
  client: Pick<AppleClient, 'lookup'>,
  id: string,
  alive: () => boolean,
): Promise<AppleLinkOutcome> {
  const looked = await client.lookup([id], alive);
  if (!alive()) return { kind: 'cancelled' };
  if (looked.kind === 'failed') return looked;
  const hit = readAppleSearch(looked.data).find((item) => item.id === id);
  return hit
    ? { kind: 'found', sourceId: hit.id, sourceArtist: hit.name, url: hit.url }
    : { kind: 'missing' };
}
