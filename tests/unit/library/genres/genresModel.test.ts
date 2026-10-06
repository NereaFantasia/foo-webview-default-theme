import { describe, expect, it } from 'vitest';
import {
  buildGenres,
  EMPTY_GENRE,
  filterGenres,
  genresQuery,
} from '../../../../src/library/genres/genresModel.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';

describe('流派归属与排序', () => {
  const one = trackRow('One', 'First', { albumArtist: 'Artist', duration: 120 });
  const two = trackRow('One', 'Second', { albumArtist: 'Artist', duration: 240 });
  const loose = trackRow('', 'Loose');
  const entries = buildGenres(
    [one, two, loose],
    new Map([
      [one.handle, ['Rock', 'Jazz', 'Rock']],
      [two.handle, ['Rock']],
    ]),
    [albumRow('One', 'Artist')],
  );

  it('真正多值分别归属，重复值只算一次；缺值在未填写里，无专辑也有曲目', () => {
    expect(entries.find((entry) => entry.key === 'Rock')).toMatchObject({
      albumCount: 1,
      duration: 360,
      tracks: [one, two],
    });
    expect(entries.find((entry) => entry.key === 'Jazz')?.tracks).toEqual([one]);
    expect(entries.find((entry) => entry.key === EMPTY_GENRE)).toMatchObject({
      albumCount: 0,
      tracks: [loose],
    });
  });
  it('升降序都把未填写放最后，按曲数排再按名字打破平局', () => {
    const keys = (desc: boolean) =>
      filterGenres(entries, '', false, 'tracks', desc, 'en').map((entry) => entry.key);
    expect(keys(false)).toEqual(['Jazz', 'Rock', EMPTY_GENRE]);
    expect(keys(true)).toEqual(['Rock', 'Jazz', EMPTY_GENRE]);
    expect(
      filterGenres(entries, 'jAz', false, 'name', false, 'en').map((entry) => entry.key),
    ).toEqual(['Jazz']);
  });
  it('整理只提示疑似问题，不把逗号或斜线自动拆成多值', () => {
    const result = buildGenres(
      [one, two, loose],
      new Map([
        [one.handle, ['Hip-Hop']],
        [two.handle, ['hip hop']],
        [loose.handle, ['Rock, Soul']],
      ]),
      [],
    );
    expect(result.map((entry) => [entry.key, entry.issue])).toEqual([
      ['Hip-Hop', 'duplicate'],
      ['hip hop', 'duplicate'],
      ['Rock, Soul', 'combined'],
    ]);
  });
});

it('查询是去重后的 OR，缺值是 PRESENT 的反向；引号、通配符、控制字符不下发', () => {
  expect(genresQuery(['Rock', EMPTY_GENRE, 'Rock'])).toBe(
    '(genre IS "Rock") OR (NOT genre PRESENT)',
  );
  expect(genresQuery(['Rock, Soul'])).toBe('genre IS "Rock, Soul"');
  for (const key of ['', 'a"b', 'Rock*', '?', 'a\0b', 'a\nb'])
    expect(genresQuery([key])).toBeNull();
  expect(genresQuery([])).toBeNull();
});
