import {
  BIOGRAPHY_DEFAULT_TTL,
  biographyArtist,
  lastfmArtistUrl,
  type BiographyLanguage,
} from '../biographyModel.ts';
import { readLastfmPhotoValue, type LastfmPhoto } from '../online/lastfmPhoto.ts';

/** 有 kind 的来自 MusicBrainz，按界面语言显示；没有的是网页资料栏原文。 */
export type BiographyFactKind = 'born' | 'died' | 'formed' | 'disbanded' | 'area' | 'aliases';

export const BIOGRAPHY_FACT_KINDS: readonly BiographyFactKind[] = [
  'born',
  'died',
  'formed',
  'disbanded',
  'area',
  'aliases',
];

export interface BiographyFact {
  readonly kind?: BiographyFactKind;
  readonly label: string;
  readonly value: string;
}

/** 有 kind 的按界面语言显示；没有的（网页上抄来的）照原文显示 label。 */
export type BiographyCounterKind = 'listeners' | 'plays';

export interface BiographyCounter {
  readonly kind?: BiographyCounterKind;
  readonly label: string;
  readonly value: number;
}

export interface BiographyRelatedArtist {
  readonly artist: string;
  readonly url: string;
}

export interface BiographyDetails {
  readonly artist: string;
  readonly language: BiographyLanguage;
  readonly url: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
  readonly tags: readonly string[];
  readonly counters: readonly BiographyCounter[];
  readonly similar: readonly BiographyRelatedArtist[];
  readonly photo?: LastfmPhoto | null;
}

export function biographyField(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' && !!value.trim() && value.length <= limit && !/[\p{Cc}]/u.test(value)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBiographyFacts(value: unknown): readonly BiographyFact[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item: unknown): BiographyFact[] => {
    if (!record(item) || !biographyField(item['label'], 80)) return [];
    if (!biographyField(item['value'], 512)) return [];
    const kind = BIOGRAPHY_FACT_KINDS.find((entry) => entry === item['kind']);
    return [{ ...(kind ? { kind } : {}), label: item['label'], value: item['value'] }];
  });
}

export function readBiographyDetails(
  value: unknown,
  artist: string,
  language: BiographyLanguage,
  now: number,
): BiographyDetails | undefined {
  if (!record(value)) return undefined;
  const { fetchedAt, expiresAt } = value;
  if (
    value['artist'] !== artist ||
    value['language'] !== language ||
    value['url'] !== lastfmArtistUrl(artist, language) ||
    typeof fetchedAt !== 'number' ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt < 0 ||
    fetchedAt > now ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    expiresAt < fetchedAt ||
    expiresAt - fetchedAt > BIOGRAPHY_DEFAULT_TTL ||
    !Array.isArray(value['tags']) ||
    !Array.isArray(value['counters']) ||
    !Array.isArray(value['similar'])
  )
    return undefined;
  return {
    artist,
    language,
    url: lastfmArtistUrl(artist, language),
    fetchedAt,
    expiresAt,
    ...(value['photo'] === undefined
      ? {}
      : { photo: readLastfmPhotoValue(value['photo'], artist, language) }),
    tags: [
      ...new Set(value['tags'].filter((tag: unknown): tag is string => biographyField(tag, 80))),
    ].slice(0, 8),
    counters: value['counters'].slice(0, 2).flatMap((item: unknown) =>
      record(item) &&
      biographyField(item['label'], 80) &&
      typeof item['value'] === 'number' &&
      Number.isSafeInteger(item['value']) &&
      item['value'] >= 0
        ? [
            {
              ...(item['kind'] === 'listeners' || item['kind'] === 'plays'
                ? { kind: item['kind'] }
                : {}),
              label: item['label'],
              value: item['value'],
            },
          ]
        : [],
    ),
    similar: value['similar']
      .slice(0, 6)
      .flatMap((item: unknown) =>
        record(item) &&
        typeof item['artist'] === 'string' &&
        biographyArtist(item['artist']) === item['artist'] &&
        item['artist'].toLowerCase() !== artist.toLowerCase() &&
        item['url'] === lastfmArtistUrl(item['artist'], language)
          ? [{ artist: item['artist'], url: lastfmArtistUrl(item['artist'], language) }]
          : [],
      ),
  };
}
