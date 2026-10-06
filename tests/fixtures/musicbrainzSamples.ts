import type { Answer, HostParams } from './fakeHost.ts';

/** 照 MusicBrainz ws/2 的 JSON 写的应答片段，字段名与嵌套与真实应答一致。 */
export const NUJABES = '1595addf-f76b-450a-a097-af852ff35f27';
export const OTHER_NUJABES = '0e9b3c34-2c4e-4b1b-8f4e-6f8c0a2d1e10';
export const SEBA = '7c1a2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

export function searchSample(...artists: readonly Record<string, unknown>[]) {
  return { created: '2026-10-02T00:00:00Z', count: artists.length, offset: 0, artists };
}

export function candidateSample(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: 'Person',
    score: 100,
    name,
    'sort-name': name,
    country: 'JP',
    'life-span': { begin: '1974-02-19', end: '2010-02-26', ended: true },
    ...extra,
  };
}

export function releaseGroupsSample(...titles: readonly string[]) {
  return {
    'release-group-count': titles.length,
    'release-group-offset': 0,
    'release-groups': titles.map((title, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title,
      'primary-type': 'Album',
    })),
  };
}

export function artistSample(id = NUJABES, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Nujabes',
    type: 'Person',
    'life-span': { begin: '1974-02-19', end: '2010-02-26', ended: true },
    area: { name: 'Japan' },
    'begin-area': { name: 'Nishi-Azabu' },
    'end-area': null,
    aliases: [
      { name: 'Jun Seba', locale: 'en', primary: null, type: 'Legal name' },
      { name: 'ヌジャベス', locale: 'ja', primary: true, type: 'Artist name' },
      { name: '瀬葉淳', locale: 'ja', primary: null, type: 'Legal name' },
      { name: 'Nujabes', locale: 'en', primary: true, type: 'Artist name' },
      { name: 'Seba Jun', locale: null, primary: null, type: 'Search hint' },
    ],
    relations: [
      { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/194395' } },
      { type: 'last.fm', url: { resource: 'https://www.last.fm/music/Nujabes' } },
      { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q462347' } },
    ],
    ...extra,
  };
}

/** 请求发往 MusicBrainz。 */
export function isMusicbrainz(url: unknown): boolean {
  try {
    return new URL(String(url)).hostname === 'musicbrainz.org';
  } catch {
    return false;
  }
}

/** MusicBrainz 一律答「没有同名候选」，身份只能手动确认；其余请求交给 `answer`。 */
export function withoutMusicbrainz(answer: Answer<'http.get'>): Answer<'http.get'> {
  return (params: HostParams) =>
    isMusicbrainz(params['url'])
      ? {
          success: true,
          status: 200,
          headers: {},
          body: JSON.stringify(searchSample()),
          responseType: 'text',
        }
      : typeof answer === 'function'
        ? answer(params)
        : answer;
}

/** 去掉发往 MusicBrainz 的请求，只看取简介本身的请求。 */
export function lastfmCalls(calls: readonly HostParams[]): readonly HostParams[] {
  return calls.filter((call) => !isMusicbrainz(call['url']));
}
