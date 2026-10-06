import { describe, expect, it } from 'vitest';
import {
  readMusicbrainzArtist,
  readMusicbrainzCandidates,
  readReleaseGroups,
} from '../../../../../src/library/biography/identity/musicbrainzArtist.ts';
import {
  artistSample,
  candidateSample,
  NUJABES,
  releaseGroupsSample,
  searchSample,
} from '../../../../fixtures/musicbrainzSamples.ts';

describe('MusicBrainz 应答解析', () => {
  it('搜索结果只留 MBID 合法、有名字的候选，带上辨认用的字段与别名', () => {
    const candidates = readMusicbrainzCandidates(
      searchSample(
        candidateSample(NUJABES, 'Nujabes', {
          disambiguation: 'Japanese producer',
          aliases: [{ name: '瀬葉淳' }, { name: '' }, { sortName: 'x' }],
        }),
        candidateSample('not-an-mbid', 'Fake'),
        candidateSample('11111111-1111-4111-8111-111111111111', ''),
        candidateSample('22222222-2222-4222-8222-222222222222', 'Nujabes', {
          'life-span': { begin: 'circa 1990' },
          country: 7,
        }),
      ),
    );
    expect(candidates).toEqual([
      {
        mbid: NUJABES,
        name: 'Nujabes',
        disambiguation: 'Japanese producer',
        type: 'Person',
        country: 'JP',
        begin: '1974-02-19',
        end: '2010-02-26',
        aliases: ['瀬葉淳'],
      },
      {
        mbid: '22222222-2222-4222-8222-222222222222',
        name: 'Nujabes',
        disambiguation: '',
        type: 'Person',
        country: '',
        begin: '',
        end: '',
        aliases: [],
      },
    ]);
    expect(readMusicbrainzCandidates({ artists: 'x' })).toEqual([]);
  });

  it('发行组读出标题与总数', () => {
    expect(readReleaseGroups(releaseGroupsSample('Modal Soul', 'Metaphorical Music'))).toEqual({
      titles: ['Modal Soul', 'Metaphorical Music'],
      total: 2,
    });
    expect(readReleaseGroups(null)).toEqual({ titles: [], total: 0 });
  });

  it('详情取 Last.fm 链接与资料：个人写出生与逝世，别名先放界面语言的主名再放本名', () => {
    expect(readMusicbrainzArtist(artistSample(), 'ja-JP')).toEqual({
      mbid: NUJABES,
      name: 'Nujabes',
      lastfmArtist: 'Nujabes',
      facts: [
        { kind: 'born', label: 'Born', value: '1974-02-19 · Nishi-Azabu' },
        { kind: 'died', label: 'Died', value: '2010-02-26' },
        { kind: 'area', label: 'Area', value: 'Japan' },
        { kind: 'aliases', label: 'Aliases', value: 'ヌジャベス · Jun Seba · 瀬葉淳' },
      ],
    });
    expect(readMusicbrainzArtist(artistSample(), 'zh-CN')?.facts.at(-1)?.value).toBe(
      'Jun Seba · 瀬葉淳',
    );
  });

  it('乐团写成立与解散；没有 Last.fm 链接时为 null，空项不出；坏应答答 null', () => {
    const group = readMusicbrainzArtist(
      artistSample(NUJABES, {
        type: 'Group',
        'life-span': { begin: '1970', end: null },
        'begin-area': null,
        area: null,
        aliases: [],
        relations: [{ type: 'last.fm', url: { resource: 'https://evil.example/music/X' } }],
      }),
      'en',
    );
    expect(group).toEqual({
      mbid: NUJABES,
      name: 'Nujabes',
      lastfmArtist: null,
      facts: [{ kind: 'formed', label: 'Formed', value: '1970' }],
    });
    for (const bad of [null, { id: 'x', name: 'A' }, { id: NUJABES, name: '' }])
      expect(readMusicbrainzArtist(bad, 'en')).toBeNull();
  });
});
