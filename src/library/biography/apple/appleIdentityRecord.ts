import { biographyArtist, type BiographyProblem } from '../biographyModel.ts';
import { biographyField } from '../details/biographyDetailsModel.ts';
import { IDENTITY_OPEN_TTL, IDENTITY_RESOLVED_TTL } from '../identity/identityRecord.ts';
import { appleArtistId, appleArtistPageUrl } from './appleCatalog.ts';
import { APPLE_CANDIDATE_LIMIT, decideAppleIdentity, type AppleCandidate } from './appleMatch.ts';

/**
 * Apple 艺人身份缓存文件名；容量与有效期策略与 MusicBrainz 缓存（`identityRecord.ts`）保持一致
 */
export const APPLE_IDENTITY_CACHE_FILE = 'apple-identity-v2.json';

interface RecordTimes {
  /** 本地艺人名，缓存按它存取 */
  readonly artist: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
}

/** 身份缓存记录项：同时保存认定过程中的候选列表，用户否定当前匹配时可直接展示候选而无需重复查询 */
export type AppleIdentityRecord =
  | (RecordTimes & {
      readonly status: 'resolved';
      readonly sourceId: string;
      readonly sourceArtist: string;
      readonly url: string;
      readonly candidates: readonly AppleCandidate[];
    })
  | (RecordTimes & {
      readonly status: 'ambiguous';
      readonly candidates: readonly AppleCandidate[];
      /** 用户主动否定匹配标记：反序列化时不再依据证据重新自动判定，避免重复认回已否定的候选 */
      readonly rejected?: true;
    })
  | (RecordTimes & { readonly status: 'none' });

/**
 * 用户偏好中手动指定的身份设置（指定特定候选或排除全部候选）；`declined` 为 true 时不展示简介也不自动匹配，直至用户重新认定
 */
export type AppleManualIdentity =
  | {
      readonly artist: string;
      readonly declined?: false;
      readonly sourceId: string;
      readonly sourceArtist: string;
      readonly url: string;
    }
  | { readonly artist: string; readonly declined: true };

/** 状态附带目标艺人标识，用于消费方在切换艺人时丢弃上一位的过时状态 */
export type AppleIdentityState = { readonly artist: string | null } & (
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | {
      readonly status: 'resolved';
      readonly sourceId: string;
      readonly sourceArtist: string;
      readonly url: string;
      readonly manual: boolean;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly AppleCandidate[] }
  | { readonly status: 'none' }
  | { readonly status: 'declined' }
  | { readonly status: 'failed'; readonly problem: BiographyProblem }
);

export const IDLE_APPLE_IDENTITY: AppleIdentityState = { artist: null, status: 'idle' };

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100_000
    ? value
    : null;
}

function text(value: unknown, limit: number): string {
  return biographyField(value, limit) ? value : '';
}

function strings(value: unknown, limit: number, size: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => biographyField(item, size)).slice(0, limit)
    : [];
}

function readYears(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const from: unknown = value[0];
  const to: unknown = value[1];
  return typeof from === 'number' &&
    typeof to === 'number' &&
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to >= from &&
    to <= 9999
    ? [from, to]
    : null;
}

function readCandidates(value: unknown): readonly AppleCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, APPLE_CANDIDATE_LIMIT).flatMap((item: unknown): AppleCandidate[] => {
    if (!record(item)) return [];
    const id = appleArtistId(item['id']);
    const url = id ? appleArtistPageUrl(item['url'], id) : null;
    const overlap = count(item['overlap']);
    const reliable = count(item['reliable']);
    const albumCount = count(item['albumCount']);
    if (
      !id ||
      !url ||
      !biographyField(item['name'], 200) ||
      typeof item['nameMatch'] !== 'boolean' ||
      overlap === null ||
      reliable === null ||
      albumCount === null
    )
      return [];
    return [
      {
        id,
        name: item['name'],
        genre: text(item['genre'], 80),
        url,
        nameMatch: item['nameMatch'],
        overlap,
        reliable: Math.min(reliable, overlap),
        matched: strings(item['matched'], 12, 300),
        albumCount,
        years: readYears(item['years']),
        samples: strings(item['samples'], 3, 300),
      },
    ];
  });
}

/** 反序列化缓存记录项；校验过期时间、必填字段与有效期区间，不符合规范时返回 null */
export function readAppleIdentityRecord(value: unknown, now: number): AppleIdentityRecord | null {
  if (!record(value)) return null;
  const { artist, fetchedAt, expiresAt, status } = value;
  if (typeof artist !== 'string' || biographyArtist(artist) !== artist) return null;
  if (typeof fetchedAt !== 'number' || typeof expiresAt !== 'number') return null;
  const ttl = status === 'resolved' ? IDENTITY_RESOLVED_TTL : IDENTITY_OPEN_TTL;
  if (fetchedAt > now || expiresAt <= now || expiresAt - fetchedAt > ttl) return null;
  const times = { artist, fetchedAt, expiresAt };
  if (status === 'none') return { ...times, status };
  const candidates = readCandidates(value['candidates']);
  if (status === 'ambiguous')
    return candidates.length
      ? { ...times, status, candidates, ...(value['rejected'] === true ? { rejected: true } : {}) }
      : null;
  const sourceId = appleArtistId(value['sourceId']);
  const url = sourceId ? appleArtistPageUrl(value['url'], sourceId) : null;
  const name = value['sourceArtist'];
  if (status !== 'resolved' || !sourceId || !url || !biographyField(name, 200)) return null;
  return { ...times, status, sourceId, sourceArtist: name, url, candidates };
}

/**
 * 将缓存记录转换为对应的认定状态（自动认定条目非手动指定）：
 * 状态为 ambiguous 且未标记 rejected 时，依据候选列表中的专辑重合数在本地重新评估认定；若命中唯一匹配则解析为 resolved
 */
export function appleIdentityStateOf(entry: AppleIdentityRecord): AppleIdentityState {
  const { artist } = entry;
  if (entry.status === 'none') return { artist, status: 'none' };
  if (entry.status === 'ambiguous') {
    // 本地重新评估：仅采纳存在专辑重合证据的候选，无重合项仍保持候选列表
    const decision = entry.rejected
      ? null
      : decideAppleIdentity(entry.candidates, { localCount: 1 });
    if (decision?.kind === 'resolved') {
      const { id, name, url } = decision.candidate;
      return { artist, status: 'resolved', sourceId: id, sourceArtist: name, url, manual: false };
    }
    return { artist, status: 'ambiguous', candidates: entry.candidates };
  }
  const { sourceId, sourceArtist, url } = entry;
  return { artist, status: 'resolved', sourceId, sourceArtist, url, manual: false };
}

/** 用户手动指定偏好对应的认定状态 */
export function appleManualStateOf(manual: AppleManualIdentity): AppleIdentityState {
  if (manual.declined) return { artist: manual.artist, status: 'declined' };
  const { artist, sourceId, sourceArtist, url } = manual;
  return { artist, status: 'resolved', sourceId, sourceArtist, url, manual: true };
}
