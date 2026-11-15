import { simplifyChars } from '../../../lyrics/online/simplifiedChars.ts';
import { matchKey, titleKey } from '../identity/artistMatch.ts';
import type { AppleAlbum, AppleArtistHit } from './appleCatalog.ts';

/** 每次最多拿几位候选去比专辑：一次批量 Lookup 带上全部，请求数不随候选数增加 */
export const APPLE_CANDIDATE_LIMIT = 8;
/** 名字一致的最多入选几位，其余名额留给排名靠前的，Apple 常把简体名映射到繁体条目或拼音名 */
const NAMED_LIMIT = 6;
/** 候选行里最多列几张专辑名 */
const SAMPLE_LIMIT = 3;
/** 可靠重合：发行年份相差不超过这么多年 */
const YEAR_GAP = 1;
/** 可靠重合：曲数相同且不少于这么多首，单曲都是 1 首，曲数相同太容易撞 */
const MIN_RELIABLE_TRACKS = 3;
/**
 * 名字不一致的候选要有这么多张标题重合（或至少一张可靠重合）才有资格被自动认定：只撞上一张通用标题
 * （Single、Greatest Hits）说明不了什么，名字一致的候选没有这条门槛
 */
const STRONG_OVERLAP = 2;
/** 本地至少有这么多张专辑（含单曲与合辑）而候选一张都没对上，就当两边不是同一位 */
const MISMATCH_ALBUMS = 3;
/** Apple 给单曲与 EP 的标题自带后缀，本地标签通常没有 */
const RELEASE_SUFFIX = /\s*[-–—]\s*(?:single|ep|e\.p\.|シングル)\s*$/i;

/** 本地的一张专辑，年份读不出时为 null */
export interface LocalAlbum {
  readonly name: string;
  readonly year: number | null;
  readonly trackCount: number;
}

/** 一位候选和它的比对结果；缓存里的候选项与候选行都用这个形状 */
export interface AppleCandidate extends AppleArtistHit {
  /** 名字（繁转简后）与本地艺人名一致 */
  readonly nameMatch: boolean;
  /** 与本地标题对上的专辑数 */
  readonly overlap: number;
  /** 其中年份或曲数也对得上的专辑数 */
  readonly reliable: number;
  /** 对上的那几张在 Apple 上的标题，候选行标明重合的是哪张 */
  readonly matched: readonly string[];
  readonly albumCount: number;
  /** 专辑发行年份的范围，一张都没有年份时为 null */
  readonly years: readonly [number, number] | null;
  /** 前几张专辑名，帮助认人 */
  readonly samples: readonly string[];
}

export type AppleDecision =
  | { readonly kind: 'resolved'; readonly candidate: AppleCandidate }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly AppleCandidate[] }
  | { readonly kind: 'none' };

/** 比名字用的键：先繁转简，再按 `matchKey` 统一全半角、大小写、标点 */
export function appleNameKey(value: string): string {
  return matchKey(simplifyChars(value.normalize('NFKC')));
}

/** 名字里的表情与装饰符号（`matchKey` 会把它们连同标点一起去掉）：山寨账号常在真名后面缀一个，当作另一个名字 */
const DECORATION = /[\p{So}\p{Extended_Pictographic}]/gu;

function decorationOf(value: string): string {
  return (value.normalize('NFKC').match(DECORATION) ?? []).join('');
}

/**
 * 两个名字算同一个：`appleNameKey` 相同，并且带的表情与装饰符号也相同。「周杰伦」与「周杰伦🫖」只差一个
 * 表情，`appleNameKey` 认为相同，这里不认，要靠专辑重合才能认定
 */
export function appleNameMatches(a: string, b: string): boolean {
  return appleNameKey(a) === appleNameKey(b) && decorationOf(a) === decorationOf(b);
}

/** 比专辑标题用的键：去掉 ` - Single`、` - EP` 后缀，再按 `titleKey` 去掉括号里的版本说明，同样先繁转简 */
export function appleTitleKey(value: string): string {
  return titleKey(simplifyChars(value.normalize('NFKC').replace(RELEASE_SUFFIX, '')));
}

/**
 * 从搜索结果里选出最多 8 位去比专辑：名字一致的优先（最多 6 位），不够再用排名靠前的补足
 * 不按排名截断，本地较小众的同名者可能排在前几位之外；名字不一致的也要带去比对，靠专辑认出的
 * 不看名字
 */
export function selectAppleCandidates(
  artist: string,
  hits: readonly AppleArtistHit[],
): readonly AppleArtistHit[] {
  const named = hits.filter((hit) => appleNameMatches(hit.name, artist)).slice(0, NAMED_LIMIT);
  const chosen = new Set(named.map((hit) => hit.id));
  const others = hits.filter((hit) => !chosen.has(hit.id) && !appleNameMatches(hit.name, artist));
  return [...named, ...others].slice(0, APPLE_CANDIDATE_LIMIT);
}

/**
 * 搜索结果里名字与本地艺人一致的恰好一位时给出它，否则答 null。这时认定多半就是他，可以趁
 * Lookup 还没回来先去取他的艺人页；一致的不止一位要等专辑比对才知道是哪位，不能猜
 */
export function uniqueNamedHit(
  artist: string,
  hits: readonly AppleArtistHit[],
): AppleArtistHit | null {
  const named = hits.filter((hit) => appleNameMatches(hit.name, artist));
  return named.length === 1 ? (named[0] ?? null) : null;
}

function yearsOf(albums: readonly AppleAlbum[]): readonly [number, number] | null {
  const years = albums.flatMap((album) => (album.year === null ? [] : [album.year]));
  return years.length ? [Math.min(...years), Math.max(...years)] : null;
}

function isReliable(local: LocalAlbum, remote: AppleAlbum): boolean {
  const sameYear =
    local.year !== null && remote.year !== null && Math.abs(local.year - remote.year) <= YEAR_GAP;
  const sameTracks =
    remote.trackCount !== null &&
    remote.trackCount === local.trackCount &&
    local.trackCount >= MIN_RELIABLE_TRACKS;
  return sameYear || sameTracks;
}

/** 拿一位候选名下的专辑与本地专辑比对：标题对上算重合，标题之外年份或曲数也对得上算可靠重合 */
export function scoreAppleCandidate(
  artist: string,
  hit: AppleArtistHit,
  albums: readonly AppleAlbum[],
  local: readonly LocalAlbum[],
): AppleCandidate {
  const byTitle = new Map<string, AppleAlbum[]>();
  for (const album of albums) {
    const key = appleTitleKey(album.title);
    const list = byTitle.get(key);
    if (list) list.push(album);
    else byTitle.set(key, [album]);
  }
  const seen = new Set<string>();
  const matched: string[] = [];
  let reliable = 0;
  for (const item of local) {
    const key = appleTitleKey(item.name);
    const remote = byTitle.get(key);
    if (!remote || seen.has(key)) continue;
    seen.add(key);
    const sure = remote.find((album) => isReliable(item, album));
    if (sure) reliable += 1;
    const title = (sure ?? remote[0])?.title;
    if (title) matched.push(title);
  }
  return {
    ...hit,
    nameMatch: appleNameMatches(hit.name, artist),
    overlap: matched.length,
    reliable,
    matched,
    albumCount: albums.length,
    years: yearsOf(albums),
    samples: albums.slice(0, SAMPLE_LIMIT).map((album) => album.title),
  };
}

/** 一批候选一起比对，`albums` 是批量 Lookup 按艺人 ID 分好的专辑，没有专辑的候选不在表里 */
export function scoreAppleCandidates(
  artist: string,
  hits: readonly AppleArtistHit[],
  albums: ReadonlyMap<string, readonly AppleAlbum[]>,
  local: readonly LocalAlbum[],
): readonly AppleCandidate[] {
  return hits.map((hit) => scoreAppleCandidate(artist, hit, albums.get(hit.id) ?? [], local));
}

/** 列给用户选的候选：有重合的排最前（可靠重合多的在前），其后是名字一致的；其余不列 */
export function listAppleCandidates(
  candidates: readonly AppleCandidate[],
): readonly AppleCandidate[] {
  const hits = candidates
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.reliable - a.reliable || b.overlap - a.overlap);
  return [...hits, ...candidates.filter((item) => item.overlap === 0 && item.nameMatch)];
}

export interface AppleDecideOptions {
  /** 为 false（用户说过「不是这位」）时不自动认定，只列候选，免得刚否定的又被认回来 */
  readonly allowAuto?: boolean;
  /**
   * 拿来比对的本地专辑有几张。没有本地专辑（0）时无从比对，名字一致就认；有本地专辑而候选没有一张对得上
   * 是反证，名字再像也不认
   */
  readonly localCount?: number;
}

/**
 * 尽量不让用户选，但不认错：有资格的候选里按证据排出第一名就认定它。有资格的是名字一致的，和名字不一致但
 * 证据够强的（见 `STRONG_OVERLAP`）。排序依次比可靠重合数、重合数、名字是否一致，最后按候选的原次序
 * （名字一致的在前，各按 Apple 的搜索次序）
 * 第一名要有重合才认；没有本地专辑可比时才退到名字一致的第一位。有本地专辑而一位也没对上：本地不少于
 * `MISMATCH_ALBUMS` 张就是查无此人（两边的目录差得太远，山寨账号与同名的另一位都是这样），更少时证据太弱，
 * 名字一致的列出来让用户确认。名字不一致又只撞上一张通用标题的也列出来，什么都没有就是查无此人
 */
export function decideAppleIdentity(
  candidates: readonly AppleCandidate[],
  { allowAuto = true, localCount = 0 }: AppleDecideOptions = {},
): AppleDecision {
  const eligible = candidates
    .map((item, order) => ({ item, order }))
    .filter(({ item }) => item.nameMatch || item.overlap >= STRONG_OVERLAP || item.reliable >= 1)
    .sort(
      (a, b) =>
        b.item.reliable - a.item.reliable ||
        b.item.overlap - a.item.overlap ||
        Number(b.item.nameMatch) - Number(a.item.nameMatch) ||
        a.order - b.order,
    );
  const top = eligible[0]?.item;
  if (allowAuto && top && (top.overlap > 0 || localCount === 0))
    return { kind: 'resolved', candidate: top };
  if (allowAuto && localCount >= MISMATCH_ALBUMS && candidates.every((item) => item.overlap === 0))
    return { kind: 'none' };
  const list = listAppleCandidates(candidates);
  return list.length ? { kind: 'ambiguous', candidates: list } : { kind: 'none' };
}

/** 用户说「不是这位」后，被否定的那位排到列表最后，避免马上又把同一个错的放在最前 */
export function demoteAppleCandidate(
  candidates: readonly AppleCandidate[],
  id: string,
): readonly AppleCandidate[] {
  return [
    ...candidates.filter((item) => item.id !== id),
    ...candidates.filter((item) => item.id === id),
  ];
}
