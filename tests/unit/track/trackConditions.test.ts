import { expect, it } from 'vitest';
import { conditionQuery, type TrackCondition } from '../../../src/track/trackConditions.ts';
import { EMPTY_TRACK_FILTER, trackQueryOf } from '../../../src/track/trackFilter.ts';

const condition = (patch: Partial<TrackCondition>): TrackCondition => ({
  field: 'rating',
  operator: 'atLeast',
  value: '3',
  end: '',
  ...patch,
});

it('数值边界包含端点，范围与其他条件同时生效', () => {
  const rating = condition({});
  const duration = condition({ field: 'duration', operator: 'between', value: '180', end: '300' });
  expect(conditionQuery(rating)).toBe('%rating% GREATER 2');
  expect(conditionQuery(duration)).toBe(
    '(%length_seconds% GREATER 179) AND (%length_seconds% LESS 301)',
  );
  expect(
    trackQueryOf({ ...EMPTY_TRACK_FILTER, conditions: [rating, duration] }, 'all'),
  ).toMatchObject({
    filtered: true,
    query:
      '(%rating% GREATER 2) AND ((%length_seconds% GREATER 179) AND (%length_seconds% LESS 301))',
  });
});

it('标签包含、精确匹配、排除和缺值保留各自语义', () => {
  expect(
    conditionQuery(condition({ field: 'albumArtist', operator: 'is', value: 'Miles Davis' })),
  ).toBe('"album artist" IS "miles davis"');
  expect(conditionQuery(condition({ field: 'genre', operator: 'excludes', value: 'Rock' }))).toBe(
    'NOT (genre HAS "rock")',
  );
  expect(conditionQuery(condition({ field: 'year', operator: 'missing' }))).toBe(
    'NOT date PRESENT',
  );
  expect(conditionQuery(condition({ field: 'genre', operator: 'missing' }))).toBe(
    'NOT genre PRESENT',
  );
});

it('播放统计允许自定最近天数及排除最近播放', () => {
  expect(conditionQuery(condition({ field: 'added', operator: 'recent', value: '30' }))).toBe(
    '%added% DURING LAST 30 DAYS',
  );
  expect(
    conditionQuery(condition({ field: 'lastPlayed', operator: 'notRecent', value: '7' })),
  ).toBe('NOT (%last_played% DURING LAST 7 DAYS)');
});

it.each([
  condition({ value: '6' }),
  condition({ value: '-1' }),
  condition({ value: '2.5' }),
  condition({ value: 'Infinity' }),
  condition({ value: '2 OR ALL' }),
  condition({ operator: 'between', value: '4', end: '3' }),
  condition({ field: 'genre', operator: 'is', value: 'a" OR ALL' }),
  condition({ field: 'genre', operator: 'is', value: 'Rock*' }),
  condition({ field: 'added', operator: 'recent', value: '0' }),
])('拒绝越界、反向区间及无法按字面表达的输入：%j', (value) => {
  expect(conditionQuery(value)).toBeNull();
});

it('声道数按数值技术字段比较，不用 mono 或 stereo 的显示文字', () => {
  expect(conditionQuery(condition({ field: 'channels', operator: 'is', value: '2' }))).toBe(
    '"$info(channels)" EQUAL 2',
  );
});
