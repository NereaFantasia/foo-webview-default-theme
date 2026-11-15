import { describe, expect, it } from 'vitest';
import {
  buildGenres,
  filterGenres,
  genresQuery,
} from '../../../../src/library/genres/genresModel.ts';
import { EMPTY_GENRE } from '../../../../src/nav/places.ts';
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
      filterGenres(entries, '', undefined, 'tracks', desc, 'en').map((entry) => entry.key);
    expect(keys(false)).toEqual(['Jazz', 'Rock', EMPTY_GENRE]);
    expect(keys(true)).toEqual(['Rock', 'Jazz', EMPTY_GENRE]);
    expect(
      filterGenres(entries, 'jAz', undefined, 'name', false, 'en').map((entry) => entry.key),
    ).toEqual(['Jazz']);
  });
  it('给出整理提示时只留有提示的流派；逗号与斜线不自动拆成多值', () => {
    const result = buildGenres(
      [one, two, loose],
      new Map([
        [one.handle, ['Rock']],
        [two.handle, ['R&B/Soul']],
        [loose.handle, ['Rock, Soul']],
      ]),
      [],
    );
    expect(result.map((entry) => entry.key)).toEqual(['Rock', 'R&B/Soul', 'Rock, Soul']);
    const issues = new Map([['Rock, Soul', []]]);
    expect(filterGenres(result, '', issues, 'name', false, 'en').map((entry) => entry.key)).toEqual(
      ['Rock, Soul'],
    );
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
