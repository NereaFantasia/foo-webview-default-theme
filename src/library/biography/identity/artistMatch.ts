import type { MusicbrainzCandidate } from './musicbrainzArtist.ts';

/**
 * 比名字用的键：全半角、大小写统一，去掉开头的 The、空白、标点与符号。
 * 名字全是标点（如「!!!」）时去光了就退回统一后的原文，免得空键彼此相等。
 */
export function matchKey(value: string): string {
  const folded = value.normalize('NFKC').toLowerCase().trim();
  const key = folded.replace(/^the\s+/, '').replace(/[\p{P}\p{S}\s]+/gu, '');
  return key || folded;
}

/** 比专辑标题用的键：再去掉括号里的版本说明（Deluxe、Remastered、Disc 2 之类）。 */
export function titleKey(value: string): string {
  return matchKey(value.replace(/\s*[([（［【][^)\]）］】]*[)\]）］】]/g, '') || value);
}

/** 名字或任一别名与本地艺人名对得上的候选，保持 MusicBrainz 的相关度次序。 */
export function nameCandidates(
  artist: string,
  candidates: readonly MusicbrainzCandidate[],
): readonly MusicbrainzCandidate[] {
  const key = matchKey(artist);
  return candidates.filter(
    (item) => matchKey(item.name) === key || item.aliases.some((alias) => matchKey(alias) === key),
  );
}

/** 一位候选名下的发行组与本地他的专辑有几张标题相同。 */
export function albumOverlap(local: readonly string[], remote: readonly string[]): number {
  const keys = new Set(remote.map(titleKey));
  return new Set(local.map(titleKey).filter((key) => keys.has(key))).size;
}

export type IdentityDecision =
  | { readonly kind: 'resolved'; readonly candidate: MusicbrainzCandidate }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly MusicbrainzCandidate[] }
  | { readonly kind: 'none' };

/**
 * 恰好一位候选与本地专辑对得上才自动认定；没有一位对得上、或不止一位对得上（同名者都有
 * 同名专辑）时列出候选让用户选。本地没有他的专辑（只客串）时无从比对，同样交给用户。
 */
export function decideIdentity(
  candidates: readonly MusicbrainzCandidate[],
  overlaps: ReadonlyMap<string, number>,
): IdentityDecision {
  const hits = candidates.filter((item) => (overlaps.get(item.mbid) ?? 0) > 0);
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only) return { kind: 'resolved', candidate: only };
  return candidates.length ? { kind: 'ambiguous', candidates } : { kind: 'none' };
}
