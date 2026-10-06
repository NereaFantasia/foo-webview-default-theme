import { biographyArtist, type BiographyProblem } from '../biographyModel.ts';
import {
  biographyField,
  readBiographyFacts,
  type BiographyFact,
} from '../details/biographyDetailsModel.ts';
import { CANDIDATE_LIMIT, isMbid, type MusicbrainzCandidate } from './musicbrainzArtist.ts';

/** 认定了的一位隔 60 天再核对；没认定的（同名待选、查无此人）7 天后再查，库里可能多了他的专辑。 */
export const IDENTITY_RESOLVED_TTL = 60 * 24 * 60 * 60 * 1000;
export const IDENTITY_OPEN_TTL = 7 * 24 * 60 * 60 * 1000;
export const IDENTITY_CACHE_FILE = 'musicbrainz-v1.json';
export const IDENTITY_CACHE_LIMIT = 256;
export const IDENTITY_CACHE_BYTES = 2 * 1024 * 1024;

interface RecordTimes {
  /** 本地艺人名，缓存按它存取。 */
  readonly artist: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
}

export type IdentityRecord =
  | (RecordTimes & {
      readonly status: 'resolved';
      readonly mbid: string;
      /** 取简介时用的 Last.fm 艺人名。 */
      readonly sourceArtist: string;
      readonly facts: readonly BiographyFact[];
      /** 认定时的同名候选，「不是这位」时直接列出来，不必再查。 */
      readonly candidates: readonly MusicbrainzCandidate[];
    })
  | (RecordTimes & {
      readonly status: 'ambiguous';
      readonly candidates: readonly MusicbrainzCandidate[];
    })
  | (RecordTimes & { readonly status: 'none' });

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, limit: number): string {
  return value === '' ? '' : biographyField(value, limit) ? value : '';
}

function readCandidates(value: unknown): readonly MusicbrainzCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CANDIDATE_LIMIT).flatMap((item: unknown): MusicbrainzCandidate[] => {
    if (!record(item) || !isMbid(item['mbid']) || !biographyField(item['name'], 200)) return [];
    const aliases = Array.isArray(item['aliases']) ? item['aliases'] : [];
    return [
      {
        mbid: item['mbid'],
        name: item['name'],
        disambiguation: field(item['disambiguation'], 200),
        type: field(item['type'], 40),
        country: field(item['country'], 8),
        begin: field(item['begin'], 10),
        end: field(item['end'], 10),
        aliases: aliases.filter((alias: unknown): alias is string => biographyField(alias, 200)),
      },
    ];
  });
}

/** 读回缓存里的一项。过期、字段不全或有效期长得不合理的都答 null。 */
export function readIdentityRecord(value: unknown, now: number): IdentityRecord | null {
  if (!record(value)) return null;
  const { artist, fetchedAt, expiresAt, status } = value;
  if (typeof artist !== 'string' || biographyArtist(artist) !== artist) return null;
  if (typeof fetchedAt !== 'number' || typeof expiresAt !== 'number') return null;
  const ttl = status === 'resolved' ? IDENTITY_RESOLVED_TTL : IDENTITY_OPEN_TTL;
  if (fetchedAt > now || expiresAt <= now || expiresAt - fetchedAt > ttl) return null;
  const times = { artist, fetchedAt, expiresAt };
  if (status === 'none') return { ...times, status };
  const candidates = readCandidates(value['candidates']);
  if (status === 'ambiguous') return candidates.length ? { ...times, status, candidates } : null;
  const { mbid, sourceArtist } = value;
  if (status !== 'resolved' || !isMbid(mbid) || typeof sourceArtist !== 'string') return null;
  if (biographyArtist(sourceArtist) !== sourceArtist) return null;
  return {
    ...times,
    status,
    mbid,
    sourceArtist,
    facts: readBiographyFacts(value['facts']),
    candidates,
  };
}

/** 每种状态都带着它属于哪位本地艺人，换人时用方据此丢掉上一位的结果。 */
export type BiographyIdentityState = { readonly artist: string | null } & (
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | {
      readonly status: 'resolved';
      readonly mbid: string | null;
      readonly sourceArtist: string;
      readonly facts: readonly BiographyFact[];
      readonly manual: boolean;
    }
  | { readonly status: 'ambiguous'; readonly candidates: readonly MusicbrainzCandidate[] }
  | { readonly status: 'none' }
  | { readonly status: 'failed'; readonly problem: BiographyProblem }
);

export const IDLE_IDENTITY: BiographyIdentityState = { artist: null, status: 'idle' };

/** 缓存里的一项对应的状态；自动认定的都不是手选。 */
export function identityStateOf(entry: IdentityRecord): BiographyIdentityState {
  const { artist } = entry;
  if (entry.status === 'none') return { artist, status: 'none' };
  if (entry.status === 'ambiguous')
    return { artist, status: 'ambiguous', candidates: entry.candidates };
  const { mbid, sourceArtist, facts } = entry;
  return { artist, status: 'resolved', mbid, sourceArtist, facts, manual: false };
}
