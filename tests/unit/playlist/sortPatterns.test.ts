import { describe, expect, it } from 'vitest';
import {
  COLUMN_SORT,
  columnOfSortKey,
  DEFAULT_GROUP_MODE,
  GROUP_MODES,
  SORT_ARTIST,
  SORT_CHOICES,
  SORT_DURATION,
  SORT_PATH,
} from '../../../src/playlist/sortPatterns.ts';

describe('sortPatterns', () => {
  it('排序子菜单十三项、id 不重复，列头能排的列反查得回来', () => {
    expect(SORT_CHOICES).toHaveLength(13);
    expect(new Set(SORT_CHOICES.map((choice) => choice.id)).size).toBe(13);
    for (const [column, pattern] of Object.entries(COLUMN_SORT)) {
      expect(columnOfSortKey(pattern)).toBe(column);
    }
    expect(columnOfSortKey(SORT_ARTIST)).toBe('artist');
    expect(columnOfSortKey(SORT_DURATION)).toBe('duration');
    expect(columnOfSortKey(SORT_PATH)).toBeNull();
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
