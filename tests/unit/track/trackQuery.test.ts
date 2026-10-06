import { describe, expect, it } from 'vitest';
import {
  ALL_QUERY,
  allOf,
  anyIs,
  isQueryableValue,
  isQueryScope,
  queryWords,
  wordsQuery,
} from '../../../src/track/trackQuery.ts';

describe('过滤框里的词', () => {
  it('折小写，按空白、双引号、半角与全角逗号切开，去重，丢掉空串', () => {
    expect(queryWords('  Nujabes "Feather",Shing02，Feather  ')).toEqual([
      'nujabes',
      'feather',
      'shing02',
    ]);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('词拼成查询', () => {
  it('全部字段：每个词在六个字段上 HAS、用 OR 连，词与词 AND', () => {
    expect(wordsQuery(['love', 'live'], 'all')).toBe(
      '(title HAS "love" OR artist HAS "love" OR "album artist" HAS "love" OR album HAS "love" OR genre HAS "love" OR date HAS "love")' +
        ' AND (title HAS "live" OR artist HAS "live" OR "album artist" HAS "live" OR album HAS "live" OR genre HAS "live" OR date HAS "live")',
    );
  });

  it('单个字段不加括号；文件名用 %filename%，专辑艺术家加引号', () => {
    expect(wordsQuery(['01', 'mix'], 'filename')).toBe(
      '%filename% HAS "01" AND %filename% HAS "mix"',
    );
    expect(wordsQuery(['va'], 'albumArtist')).toBe('"album artist" HAS "va"');
    expect(wordsQuery([], 'title')).toBe('');
  });

  it('认得九档字段范围', () => {
    expect(isQueryScope('comment')).toBe(true);
    expect(isQueryScope('lyrics')).toBe(false);
  });
});

describe('值与几段查询', () => {
  it('带引号、通配符的值与空值写不进 IS', () => {
    expect(isQueryableValue('Hip-Hop')).toBe(true);
    expect(isQueryableValue('Say "Hi"')).toBe(false);
    expect(isQueryableValue('What?')).toBe(false);
    expect(isQueryableValue('A*B')).toBe(false);
    expect(isQueryableValue('')).toBe(false);
  });

  it('几个值任一相等用 OR 连，一个值不加括号', () => {
    expect(anyIs('genre', ['Jazz'])).toBe('genre IS "Jazz"');
    expect(anyIs('genre', ['Jazz', 'Rock'])).toBe('(genre IS "Jazz" OR genre IS "Rock")');
  });

  it('几段都要成立：各加括号用 AND 连；一段原样；没有就是整个媒体库', () => {
    expect(allOf(['a OR b', ' ', 'c'])).toBe('(a OR b) AND (c)');
    expect(allOf(['a OR b'])).toBe('a OR b');
    expect(allOf([])).toBe(ALL_QUERY);
  });
});
