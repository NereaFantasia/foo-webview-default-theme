import { describe, expect, it } from 'vitest';
import { conditionQuery } from '../../../../src/track/trackConditions.ts';
import { conditionChoices, yearOf } from '../../../../src/playlist/filter/rowConditions.ts';
import { playlistRowOf } from '../../../../src/playlist/playlistRow.ts';
import { makeRow } from '../../../fixtures/fakePlaylists.ts';

const row = (overrides: Parameters<typeof makeRow>[2] = {}) =>
  playlistRowOf(makeRow('Main', 0, overrides));

describe('yearOf', () => {
  it('年份按第一个四位数认，认不出是空串', () => {
    expect(yearOf('1991-05-13')).toBe('1991');
    expect(yearOf('May 1991')).toBe('1991');
    expect(yearOf('')).toBe('');
  });
});

describe('conditionChoices', () => {
  it('几位艺人各一项，再是专辑、流派、年份；空值、带引号或通配符、流派写了好几个的不能加', () => {
    const track = row({
      artists: ['Triodust', 'Chia'],
      album: 'What? Now',
      genre: 'Jazz, Hip-Hop',
      date: '',
    });
    expect(
      conditionChoices(track).map(({ field, condition, usable }) => [
        field,
        condition.value,
        usable,
      ]),
    ).toStrictEqual([
      ['artist', 'Triodust', true],
      ['artist', 'Chia', true],
      ['album', 'What? Now', false],
      ['genre', 'Jazz, Hip-Hop', false],
      ['year', '', false],
    ]);
  });

  it('没拆开的艺人退回整串', () => {
    const track = row({ artist: 'Nujabes', artists: [] });
    expect(conditionChoices(track)[0]?.condition).toStrictEqual({
      field: 'artist',
      operator: 'is',
      value: 'Nujabes',
      end: '',
    });
  });

  it('加出来的是「等于」条件，与条件编辑器加的同一种：能直接译成宿主查询', () => {
    const track = row({ artist: 'Chia', artists: ['Chia'], album: 'Night', date: '2019-05-01' });
    const queries = conditionChoices(track).map(({ condition }) => conditionQuery(condition));
    expect(queries).toStrictEqual([
      'artist IS "chia"',
      'album IS "night"',
      'genre IS "hip-hop"',
      '"$left(%date%,4)" EQUAL 2019',
    ]);
  });
});
