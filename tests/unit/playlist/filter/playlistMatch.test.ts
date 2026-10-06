import { describe, expect, it } from 'vitest';
import {
  conditionChoices,
  fileNameOf,
  filterWords,
  rowMatcher,
  sameConditions,
  yearOf,
  type PlaylistCondition,
} from '../../../../src/playlist/filter/playlistMatch.ts';
import { playlistRowOf } from '../../../../src/playlist/playlistRow.ts';
import { makeRow } from '../../../fixtures/fakePlaylists.ts';

const row = (overrides: Parameters<typeof makeRow>[2] = {}) =>
  playlistRowOf(makeRow('Main', 0, overrides));

describe('filterWords', () => {
  it('折成小写，按空白、双引号与逗号切开，重复的只留一个', () => {
    expect(filterWords('  Blue  "Moon",  blue，chia ')).toStrictEqual(['blue', 'moon', 'chia']);
    expect(filterWords(' " , ')).toStrictEqual([]);
  });
});

describe('yearOf 与 fileNameOf', () => {
  it('年份按第一个四位数认；文件名去掉目录与扩展名', () => {
    expect(yearOf('1991-05-13')).toBe('1991');
    expect(yearOf('May 1991')).toBe('1991');
    expect(yearOf('')).toBe('');
    expect(fileNameOf('file://E:/Music/A/01 Safe.flac')).toBe('01 Safe');
    expect(fileNameOf('E:\\Music\\track')).toBe('track');
  });
});

describe('rowMatcher', () => {
  const blue = row({
    title: 'Blue Lines',
    artist: 'Massive Attack',
    artists: ['Massive Attack'],
    albumArtist: 'Massive Attack',
    album: 'Blue Lines',
    genre: 'Trip-Hop',
    date: '1991-04-08',
    path: 'file://E:/Music/MA/03 Blue Lines.flac',
  });
  const none = {};

  it('几个词都要命中、不分先后，每个词落在范围里的任一字段就算', () => {
    expect(rowMatcher(['lines', 'blue'], 'all', [])(blue, none)).toBe(true);
    expect(rowMatcher(['blue', 'massive'], 'all', [])(blue, none)).toBe(true);
    expect(rowMatcher(['blue', 'zzz'], 'all', [])(blue, none)).toBe(false);
    expect(rowMatcher(['massive'], 'title', [])(blue, none)).toBe(false);
    expect(rowMatcher(['massive'], 'albumArtist', [])(blue, none)).toBe(true);
  });

  it('「全部字段」不含文件名与注释；这两档分别比文件名与另取的注释列', () => {
    const noted = { comment: 'Remastered 2012' };
    expect(rowMatcher(['03'], 'all', [])(blue, noted)).toBe(false);
    expect(rowMatcher(['03'], 'filename', [])(blue, noted)).toBe(true);
    expect(rowMatcher(['remastered'], 'all', [])(blue, noted)).toBe(false);
    expect(rowMatcher(['remastered'], 'comment', [])(blue, noted)).toBe(true);
    expect(rowMatcher(['remastered'], 'comment', [])(blue, none)).toBe(false);
  });

  it('条件比整个值、大小写不计，都要成立；艺术家按拆开的每一位比', () => {
    const duo = row({ artist: 'Triodust, Chia', artists: ['Triodust', 'Chia'], date: '2019' });
    const artist = (value: string): PlaylistCondition => ({ field: 'artist', value });
    expect(rowMatcher([], 'all', [artist('chia')])(duo, none)).toBe(true);
    expect(rowMatcher([], 'all', [artist('Triodust, Chia')])(duo, none)).toBe(false);
    expect(rowMatcher([], 'all', [artist('Chi')])(duo, none)).toBe(false);
    const both: PlaylistCondition[] = [artist('Chia'), { field: 'year', value: '2019' }];
    expect(rowMatcher([], 'all', both)(duo, none)).toBe(true);
    expect(rowMatcher(['nope'], 'all', both)(duo, none)).toBe(false);
    expect(rowMatcher([], 'all', [{ field: 'album', value: 'blue lines' }])(blue, none)).toBe(true);
    expect(rowMatcher([], 'all', [{ field: 'genre', value: 'TRIP-HOP' }])(blue, none)).toBe(true);
  });
});

describe('conditionChoices', () => {
  it('几位艺术家各一项，再是专辑、流派、年份；空值、带引号或通配符、流派写了好几个的不能加', () => {
    const track = row({
      artists: ['Triodust', 'Chia'],
      album: 'What? Now',
      genre: 'Jazz, Hip-Hop',
      date: '',
    });
    expect(
      conditionChoices(track).map(({ condition, usable }) => [
        condition.field,
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

  it('没拆开的艺术家退回整串', () => {
    const track = row({ artist: 'Nujabes', artists: [] });
    expect(conditionChoices(track)[0]?.condition).toStrictEqual({
      field: 'artist',
      value: 'Nujabes',
    });
  });
});

describe('sameConditions', () => {
  it('按先后与值比，大小写不计', () => {
    const a: PlaylistCondition[] = [{ field: 'artist', value: 'Chia' }];
    expect(sameConditions(a, [{ field: 'artist', value: 'chia' }])).toBe(true);
    expect(sameConditions(a, [{ field: 'album', value: 'Chia' }])).toBe(false);
    expect(sameConditions(a, [])).toBe(false);
  });
});
