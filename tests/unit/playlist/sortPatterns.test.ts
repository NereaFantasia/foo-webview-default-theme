import { makeRow } from '../../fixtures/fakePlaylists.ts';
import { formatTitle } from '../../fixtures/fakeTitleFormat.ts';
import { describe, expect, it } from 'vitest';
import {
  COLUMN_SORT,
  DEFAULT_GROUP_MODE,
  GROUP_MODES,
  SORT_ARTIST,
  SORT_CHOICES,
  SORT_DURATION,
  SORT_PATH,
} from '../../../src/playlist/sortPatterns.ts';

describe('sortPatterns', () => {
  it('排序表 id 不重复；列头能排的列用的串都出自排序表，同一个字段只有一个写法', () => {
    expect(SORT_CHOICES).toHaveLength(19);
    expect(new Set(SORT_CHOICES.map((choice) => choice.id)).size).toBe(19);
    const patterns = new Set(SORT_CHOICES.map((choice) => choice.pattern));
    for (const pattern of Object.values(COLUMN_SORT)) expect(patterns.has(pattern)).toBe(true);
    expect(COLUMN_SORT.artist).toBe(SORT_ARTIST);
    expect(COLUMN_SORT.duration).toBe(SORT_DURATION);
    expect(COLUMN_SORT.path).toBe(SORT_PATH);
  });

  it('缺省分组是「专辑 | 专辑艺术家」加碟号两级；每档都带切过去时的重排串', () => {
    expect(GROUP_MODES[DEFAULT_GROUP_MODE]).toStrictEqual({
      id: 'albumArtistAlbumDisc',
      patterns: ['%album% | %album artist%', '$if2(%discnumber%,)'],
      sort: SORT_CHOICES.find((choice) => choice.id === 'albumArtist')?.pattern,
    });
    expect(GROUP_MODES).toHaveLength(6);
    for (const mode of GROUP_MODES) {
      expect(mode.patterns.length).toBeGreaterThan(0);
      expect(mode.sort).not.toBe('');
    }
  });
});

it('路径列升序比较完整文件名，不被标题的顺序覆盖', () => {
  const rows = [
    makeRow('Main', 0, { title: 'A', path: 'file://E:/Music/z.flac' }),
    makeRow('Main', 1, { title: 'Z', path: 'file://E:/Music/a.flac' }),
  ];
  const sorted = [...rows].sort((a, b) =>
    formatTitle(SORT_PATH, a).localeCompare(formatTitle(SORT_PATH, b)),
  );
  expect(sorted.map((row) => row.title)).toEqual(['Z', 'A']);
});
