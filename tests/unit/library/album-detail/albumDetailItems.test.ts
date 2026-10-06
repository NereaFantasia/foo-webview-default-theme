import { describe, expect, it } from 'vitest';
import {
  buildDetailRows,
  detailNumberText,
  detailSort,
  detailSortField,
  filterDetailTracks,
  nextDetailSort,
} from '../../../../src/library/album-detail/albumDetailItems.ts';
import { albumTrackRow } from '../../../fixtures/libraryRows.ts';

const track = (title: string, disc: number, number: number, extra = {}) =>
  albumTrackRow('Album', 'Artist', title, {
    discNumber: disc,
    trackNumber: number,
    path: `file://E:\\Music\\${disc}-${number}.flac`,
    ...extra,
  });

const TWO_DISCS = [track('B', 1, 1), track('A', 1, 2), track('D', 2, 1), track('C', 2, 2)];

const kinds = (rows: ReturnType<typeof buildDetailRows>) =>
  rows.items.map((item) =>
    item.kind === 'group' ? `disc ${item.data.disc}` : item.kind === 'row' ? item.track?.title : '',
  );

describe('条目流', () => {
  it('碟、曲顺序下多碟专辑每张碟前放一个分组头，行序号按显示顺序', () => {
    const rows = buildDetailRows(TWO_DISCS, null, 2);
    expect(kinds(rows)).toEqual(['disc 1', 'B', 'A', 'disc 2', 'D', 'C']);
    expect(rows.items.flatMap((item) => (item.kind === 'row' ? [item.order] : []))).toEqual([
      0, 1, 2, 3,
    ]);
    const group = rows.items[3];
    expect(group?.kind === 'group' && group.data.tracks.map((one) => one.title)).toEqual([
      'D',
      'C',
    ]);
    expect(group?.kind === 'group' && group.collapsed).toBe(false);
  });

  it('单碟专辑不放分组头', () => {
    const rows = buildDetailRows([track('B', 1, 1), track('A', 1, 2)], null, 1);
    expect(kinds(rows)).toEqual(['B', 'A']);
  });

  it('按别的列排时平铺，比不出的保持原顺序；反向时整条倒过来', () => {
    const same = [track('Same', 1, 1), track('Other', 1, 2), track('Same', 2, 1)];
    const up = buildDetailRows(same, { column: 'title', descending: false }, 2);
    expect(kinds(up)).toEqual(['Other', 'Same', 'Same']);
    expect(up.tracks[1]?.discNumber).toBe(1);
    const down = buildDetailRows(TWO_DISCS, { column: 'title', descending: true }, 2);
    expect(kinds(down)).toEqual(['D', 'C', 'B', 'A']);
    expect(down.tracks.map((one) => one.title)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('按等级排用此刻的星级，不用取回时行里的旧值', () => {
    const tracks = [track('Rated', 1, 1, { rating: 1 }), track('Plain', 1, 2, { rating: 3 })];
    const now = new Map([['Rated', 5]]);
    const rows = buildDetailRows(
      tracks,
      { column: 'rating', descending: true },
      1,
      0,
      (one) => now.get(one.title) ?? one.rating,
    );
    expect(rows.tracks.map((one) => one.title)).toEqual(['Rated', 'Plain']);
  });

  it('按时长、等级、艺术家排', () => {
    const tracks = [
      track('Long', 1, 1, { duration: 300, rating: 1, artist: 'Zed' }),
      track('Short', 1, 2, { duration: 100, rating: 5, artist: 'Amy' }),
    ];
    const titles = (column: 'duration' | 'rating' | 'artist') =>
      buildDetailRows(tracks, { column, descending: false }, 1).tracks.map((one) => one.title);
    expect(titles('duration')).toEqual(['Short', 'Long']);
    expect(titles('rating')).toEqual(['Long', 'Short']);
    expect(titles('artist')).toEqual(['Short', 'Long']);
  });

  it('曲目还没到时画给定的行数骨架', () => {
    const rows = buildDetailRows([], null, 1, 3);
    expect(rows.items.map((item) => item.kind === 'row' && item.track)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(rows.tracks).toEqual([]);
  });

  it('键跟着曲目走，换了排序焦点仍认得同一首', () => {
    const before = buildDetailRows(TWO_DISCS, null, 2);
    const after = buildDetailRows(TWO_DISCS, { column: 'title', descending: false }, 2);
    const keyOf = (rows: typeof before, title: string) =>
      rows.items.find((item) => item.kind === 'row' && item.track?.title === title)?.key;
    expect(keyOf(after, 'C')).toBe(keyOf(before, 'C'));
  });
});

describe('列头排序', () => {
  it('点一列升序，再点反向，点 # 回到碟、曲顺序', () => {
    const title = nextDetailSort(null, 'title');
    expect(title).toEqual({ column: 'title', descending: false });
    expect(nextDetailSort(title, 'title')).toEqual({ column: 'title', descending: true });
    expect(nextDetailSort(title, 'artist')).toEqual({ column: 'artist', descending: false });
    expect(nextDetailSort(title, 'number')).toBeNull();
  });

  it('默认顺序点 # 变降序，再点恢复默认；独立方向按钮使用同一份排序', () => {
    const down = nextDetailSort(null, 'number');
    expect(down).toEqual({ column: 'number', descending: true });
    expect(nextDetailSort(down, 'number')).toBeNull();
    expect(detailSortField(null)).toBe('number');
    expect(detailSort('number', false)).toBeNull();
    expect(detailSort('duration', true)).toEqual({ column: 'duration', descending: true });
    const rows = buildDetailRows(TWO_DISCS, down, 2);
    expect(kinds(rows)).toEqual(['disc 2', 'C', 'D', 'disc 1', 'A', 'B']);
    const group = rows.items[0];
    expect(group?.kind === 'group' && group.data.tracks.map((one) => one.title)).toEqual([
      'C',
      'D',
    ]);
    expect(detailNumberText(down, 2)(TWO_DISCS[2]!)).toBe('1');
    expect(TWO_DISCS.map((one) => one.title)).toEqual(['B', 'A', 'D', 'C']);
  });
});

describe('页内查找', () => {
  const tracks = [
    track('Spring Rain', 1, 1, { artist: 'FELT feat. Vivienne' }),
    track('Spring Wind', 2, 1, { artist: 'FELT' }),
    track('Night Garden', 2, 2, { artist: 'Vivienne' }),
  ];

  it('忽略大小写与多余空白，各个词可分别匹配标题和艺人', () => {
    expect(filterDetailTracks(tracks, '  SPRING \t vivienne\n')).toEqual([tracks[0]]);
    expect(filterDetailTracks(tracks, ' \t\n')).toBe(tracks);
    expect(filterDetailTracks(tracks, 'Album')).toEqual([]);
    expect(filterDetailTracks(tracks, 'spring missing')).toEqual([]);
  });

  it('先筛后排，只为命中的碟生成分组，保留原始曲号', () => {
    const filtered = filterDetailTracks(tracks, 'vivienne');
    const rows = buildDetailRows(filtered, detailSort('number', true), 2);
    expect(kinds(rows)).toEqual(['disc 2', 'Night Garden', 'disc 1', 'Spring Rain']);
    expect(rows.tracks.map((one) => one.trackNumber)).toEqual([2, 1]);
    expect(kinds(buildDetailRows(filterDetailTracks(tracks, 'absent'), null, 2))).toEqual([]);
  });
});

describe('序号格', () => {
  it('分碟显示或单碟时只写曲号；多碟平铺时写「碟.曲」', () => {
    const one = track('A', 2, 3);
    expect(detailNumberText(null, 2)(one)).toBe('3');
    expect(detailNumberText({ column: 'title', descending: false }, 1)(one)).toBe('3');
    expect(detailNumberText({ column: 'title', descending: false }, 2)(one)).toBe('2.03');
  });
});
