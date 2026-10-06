import { lastfmArtistFromUrl } from '../biographyModel.ts';
import { biographyField, type BiographyFact } from '../details/biographyDetailsModel.ts';

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 这几种类型的生卒写成「成立」「解散」，其余按人写「出生」「逝世」。 */
const GROUP_TYPES = new Set(['Group', 'Orchestra', 'Choir']);
/** 候选列表最多留几位：MusicBrainz 按相关度排序，再往后基本是别的同名者。 */
export const CANDIDATE_LIMIT = 5;

export function isMbid(value: unknown): value is string {
  return typeof value === 'string' && MBID.test(value);
}

/** 同名候选里给用户辨认用的信息，全部取自搜索结果，不再逐个查。 */
export interface MusicbrainzCandidate {
  readonly mbid: string;
  readonly name: string;
  readonly disambiguation: string;
  readonly type: string;
  readonly country: string;
  readonly begin: string;
  readonly end: string;
  readonly aliases: readonly string[];
}

export interface MusicbrainzArtist {
  readonly mbid: string;
  readonly name: string;
  /** MusicBrainz 链到的 Last.fm 艺人名；没有这条链接时为 null。 */
  readonly lastfmArtist: string | null;
  readonly facts: readonly BiographyFact[];
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = 200): string {
  return biographyField(value, limit) ? value.trim() : '';
}

function lifeSpan(value: unknown): { readonly begin: string; readonly end: string } {
  const span = record(value) ? value : {};
  const date = (item: unknown) =>
    typeof item === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(item) ? item : '';
  return { begin: date(span['begin']), end: date(span['end']) };
}

function aliasNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const name = record(item) ? text(item['name']) : '';
    return name ? [name] : [];
  });
}

/** `artist?query=` 的搜索结果。 */
export function readMusicbrainzCandidates(data: unknown): readonly MusicbrainzCandidate[] {
  const artists = record(data) ? data['artists'] : undefined;
  if (!Array.isArray(artists)) return [];
  return artists.flatMap((item: unknown): MusicbrainzCandidate[] => {
    if (!record(item) || !isMbid(item['id'])) return [];
    const name = text(item['name']);
    if (!name) return [];
    return [
      {
        mbid: item['id'],
        name,
        disambiguation: text(item['disambiguation']),
        type: text(item['type'], 40),
        country: text(item['country'], 8),
        ...lifeSpan(item['life-span']),
        aliases: aliasNames(item['aliases']),
      },
    ];
  });
}

/** `release-group?artist=` 的一页标题，以及他名下发行组的总数（判断要不要翻页）。 */
export function readReleaseGroups(data: unknown): {
  readonly titles: readonly string[];
  readonly total: number;
} {
  const groups = record(data) ? data['release-groups'] : undefined;
  const total = record(data) ? data['release-group-count'] : undefined;
  return {
    titles: Array.isArray(groups)
      ? groups.flatMap((item: unknown) => {
          const title = record(item) ? text(item['title'], 500) : '';
          return title ? [title] : [];
        })
      : [],
    total: typeof total === 'number' && Number.isSafeInteger(total) ? total : 0,
  };
}

function areaName(value: unknown): string {
  return record(value) ? text(value['name']) : '';
}

/**
 * 别名：先放与界面语言同一种的主名，再放本名一类；去掉与艺人名相同的，最多四个。
 * MusicBrainz 的 `locale` 是 ja、zh_Hans 这样的写法，只比语言部分。
 */
function aliasFact(value: unknown, name: string, locale: string): string {
  if (!Array.isArray(value)) return '';
  const language = locale.split(/[-_]/)[0]?.toLowerCase() ?? '';
  const ranked = value.flatMap((item: unknown) => {
    if (!record(item)) return [];
    const alias = text(item['name']);
    if (!alias || alias === name) return [];
    const local = text(item['locale'], 20).split('_')[0]?.toLowerCase() === language;
    const rank = local && item['primary'] === true ? 0 : item['type'] === 'Legal name' ? 1 : 2;
    return rank < 2 || local ? [{ alias, rank }] : [];
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return [...new Set(ranked.map((item) => item.alias))].slice(0, 4).join(' · ');
}

/** `artist/<mbid>?inc=url-rels+aliases` 的应答。资料只留有值的几项。 */
export function readMusicbrainzArtist(data: unknown, locale: string): MusicbrainzArtist | null {
  if (!record(data) || !isMbid(data['id'])) return null;
  const name = text(data['name']);
  if (!name) return null;
  let lastfmArtist: string | null = null;
  for (const relation of Array.isArray(data['relations']) ? data['relations'] : []) {
    if (!record(relation) || relation['type'] !== 'last.fm' || !record(relation['url'])) continue;
    const resource = relation['url']['resource'];
    const linked = typeof resource === 'string' ? lastfmArtistFromUrl(resource) : null;
    if (linked) {
      lastfmArtist = linked;
      break;
    }
  }
  const group = GROUP_TYPES.has(text(data['type'], 40));
  const { begin, end } = lifeSpan(data['life-span']);
  const facts: BiographyFact[] = [];
  const add = (kind: BiographyFact['kind'], label: string, ...parts: string[]) => {
    const value = parts.filter(Boolean).join(' · ');
    if (kind && value) facts.push({ kind, label, value });
  };
  add(group ? 'formed' : 'born', group ? 'Formed' : 'Born', begin, areaName(data['begin-area']));
  add(group ? 'disbanded' : 'died', group ? 'Disbanded' : 'Died', end, areaName(data['end-area']));
  add('area', 'Area', areaName(data['area']));
  add('aliases', 'Aliases', aliasFact(data['aliases'], name, locale));
  return { mbid: data['id'], name, lastfmArtist, facts };
}
