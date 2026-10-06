import { biographyArtist } from '../biographyModel.ts';
import { albumOverlap, decideIdentity, nameCandidates } from './artistMatch.ts';
import { IDENTITY_OPEN_TTL, IDENTITY_RESOLVED_TTL, type IdentityRecord } from './identityRecord.ts';
import type { MusicbrainzClient, MusicbrainzResult } from './musicbrainzApi.ts';
import {
  CANDIDATE_LIMIT,
  readMusicbrainzArtist,
  readMusicbrainzCandidates,
  readReleaseGroups,
  type MusicbrainzArtist,
} from './musicbrainzArtist.ts';

/** 每次最多拿几位同名候选去比专辑：每位一次请求，按每秒一次排队。 */
const COMPARED = 3;

export type MusicbrainzFailure = Extract<MusicbrainzResult, { kind: 'failed' }>;

export type IdentityOutcome =
  | { readonly kind: 'record'; readonly entry: IdentityRecord }
  | MusicbrainzFailure
  | { readonly kind: 'cancelled' };

function escapeQuery(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

/** 查一位的详情（Last.fm 链接、资料）。查无此人或应答对不上答 null。 */
export async function lookupArtist(
  client: MusicbrainzClient,
  mbid: string,
  locale: string,
  alive: () => boolean,
): Promise<MusicbrainzArtist | MusicbrainzFailure | null> {
  const answer = await client.request(`artist/${mbid}`, { inc: 'url-rels+aliases' }, alive);
  if (answer.kind === 'failed') return answer;
  const info = answer.kind === 'data' ? readMusicbrainzArtist(answer.data, locale) : null;
  return info?.mbid === mbid ? info : null;
}

/** 取简介用的 Last.fm 名字：MusicBrainz 链到 Last.fm 的那个，没有就用他在 MusicBrainz 上的名字。 */
export function sourceArtistOf(info: MusicbrainzArtist): string | null {
  return info.lastfmArtist ?? biographyArtist(info.name);
}

/**
 * 按名字搜同名候选，拿前几位的发行组与本地专辑比对，按 `decideIdentity` 认定或列出候选。
 * `compare` 为 false（用户说过「不是这位」）时不比对，直接列候选。请求里只有艺人名与 MBID。
 */
export async function resolveIdentity(
  client: MusicbrainzClient,
  artist: string,
  albums: readonly string[],
  locale: string,
  compare: boolean,
  alive: () => boolean,
): Promise<IdentityOutcome> {
  const term = escapeQuery(artist);
  const found = await client.request(
    'artist',
    { query: `artist:"${term}" OR alias:"${term}"`, limit: '10' },
    alive,
  );
  if (!alive()) return { kind: 'cancelled' };
  if (found.kind === 'failed') return found;
  const all = found.kind === 'data' ? readMusicbrainzCandidates(found.data) : [];
  const candidates = nameCandidates(artist, all).slice(0, CANDIDATE_LIMIT);
  const overlaps = new Map<string, number>();
  for (const candidate of compare && albums.length ? candidates.slice(0, COMPARED) : []) {
    const groups = await client.request(
      'release-group',
      // 只比专辑与 EP：单曲占了发行组的大半，一页 100 个装不下时本地专辑可能排在后面。
      { artist: candidate.mbid, type: 'album|ep', limit: '100' },
      alive,
    );
    if (!alive()) return { kind: 'cancelled' };
    if (groups.kind === 'failed') return groups;
    const titles = groups.kind === 'data' ? readReleaseGroups(groups.data).titles : [];
    overlaps.set(candidate.mbid, albumOverlap(albums, titles));
  }
  const decision = decideIdentity(candidates, overlaps);
  const now = Date.now();
  const open = { artist, fetchedAt: now, expiresAt: now + IDENTITY_OPEN_TTL };
  if (decision.kind === 'none') return { kind: 'record', entry: { ...open, status: 'none' } };
  const ambiguous: IdentityRecord = { ...open, status: 'ambiguous', candidates };
  if (decision.kind === 'ambiguous') return { kind: 'record', entry: ambiguous };
  const { mbid } = decision.candidate;
  const info = await lookupArtist(client, mbid, locale, alive);
  if (!alive()) return { kind: 'cancelled' };
  if (info && 'kind' in info) return info;
  const sourceArtist = info && sourceArtistOf(info);
  if (!info || !sourceArtist) return { kind: 'record', entry: ambiguous };
  return {
    kind: 'record',
    entry: {
      ...open,
      expiresAt: now + IDENTITY_RESOLVED_TTL,
      status: 'resolved',
      mbid,
      sourceArtist,
      facts: info.facts,
      candidates,
    },
  };
}
