import { describe, expect, it } from 'vitest';
import {
  homeAgo,
  homeGemQuery,
  homeStatistics,
  type HomePlaycountRow,
} from '../../../../src/library/home/homeModel.ts';
import { trackPathOf } from '../../../../src/host/libraryContract.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';

describe('首页专辑与统计', () => {
  it('最近播放与添加按专辑内最新可靠时间聚合，不用文件日期', () => {
    const albums = [albumRow('A', 'Artist'), albumRow('B', 'Artist'), albumRow('C', 'Artist')];
    const tracks = [
      albumTrackRow('A', 'Artist', 'A1'),
      albumTrackRow('A', 'Artist', 'A2'),
      albumTrackRow('B', 'Artist', 'B1'),
      albumTrackRow('C', 'Artist', 'C1', { date: '2099' }),
    ];
    const rows = new Map<string, HomePlaycountRow>(
      tracks.map((track, index) => [
        trackPathOf(track),
        {
          path: trackPathOf(track),
          success: true,
          lastPlayed: ['2020-01-01 00:00:00', '2026-09-01 00:00:00', '2025-01-01 00:00:00', ''][
            index
          ],
          added: ['', '2021-01-01 00:00:00', '2025-01-01 00:00:00', ''][index],
        },
      ]),
    );
    const result = homeStatistics(albums, tracks, rows);
    expect(result.recent).toEqual([
      { album: albums[0], playedAt: new Date('2026-09-01T00:00:00').getTime() },
      { album: albums[1], playedAt: new Date('2025-01-01T00:00:00').getTime() },
    ]);
    expect(result.added).toEqual([albums[1], albums[0]]);
  });

  it('最常播放按累计次数排曲目、专辑与艺人，没播放过的不上榜', () => {
    const albums = [albumRow('A', 'X'), albumRow('B', 'X'), albumRow('C', 'Y')];
    const tracks = [
      albumTrackRow('A', 'X', 'A1'),
      albumTrackRow('A', 'X', 'A2'),
      albumTrackRow('B', 'X', 'B1'),
      albumTrackRow('C', 'Y', 'C1'),
      albumTrackRow('C', 'Y', 'C2'),
    ];
    const counts = [3, 4, 2, 8, 0];
    const rows = new Map<string, HomePlaycountRow>(
      tracks.map((track, index) => [
        trackPathOf(track),
        { path: trackPathOf(track), success: true, playCount: counts[index] },
      ]),
    );
    const { mostPlayed } = homeStatistics(albums, tracks, rows);
    expect(mostPlayed.plays).toBe(17);
    expect(mostPlayed.tracks.played).toBe(4);
    expect(mostPlayed.tracks.top.map(({ item, plays }) => [item.title, plays])).toEqual([
      ['C1', 8],
      ['A2', 4],
      ['A1', 3],
      ['B1', 2],
    ]);
    expect(mostPlayed.albums.top.map(({ item, plays }) => [item.name, plays])).toEqual([
      ['C', 8],
      ['A', 7],
      ['B', 2],
    ]);
    expect(mostPlayed.artists).toEqual({
      top: [
        { item: { name: 'X', albums: 2, cover: albums[0] }, plays: 9 },
        { item: { name: 'Y', albums: 1, cover: albums[2] }, plays: 8 },
      ],
      played: 2,
    });
  });

  it('每月新增按自然月数最近 12 个月，另数最近 30 天', () => {
    const tracks = Array.from({ length: 5 }, (_, index) =>
      albumTrackRow('A', 'Artist', String(index)),
    );
    const added = [
      '2026-10-20 08:00:00',
      '2026-10-01 08:00:00',
      '2026-09-05 08:00:00',
      '2025-11-30 08:00:00',
      '2025-10-31 08:00:00',
    ];
    const rows = new Map<string, HomePlaycountRow>(
      tracks.map((track, index) => [
        trackPathOf(track),
        { path: trackPathOf(track), success: true, added: added[index] },
      ]),
    );
    const result = homeStatistics([], tracks, rows, new Date('2026-10-25T12:00:00').getTime());
    expect(result.addedByMonth).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
    expect(result.addedRecently).toBe(2);
  });

  it('遗珠要求四星且26周未听；从未播放必须有可靠添加时间与零次统计', () => {
    const tracks = Array.from({ length: 6 }, (_, index) =>
      albumTrackRow('A', 'Artist', String(index), { rating: index === 1 ? 3 : 4 }),
    );
    const rows = new Map<string, HomePlaycountRow>(
      tracks.map((track, index) => [
        trackPathOf(track),
        {
          path: trackPathOf(track),
          success: index !== 5,
          playCount: 0,
          lastPlayed: index < 2 ? '2020-01-01 00:00:00' : '',
          added: index === 3 ? '' : '2025-01-01 00:00:00',
        },
      ]),
    );
    const result = homeStatistics([], tracks, rows, Date.parse('2026-10-01'));
    expect(result.forgotten).toEqual([
      { track: tracks[0], playedAt: new Date('2020-01-01T00:00:00').getTime() },
    ]);
    expect(result.unplayed.map(({ track }) => track)).toEqual([tracks[2], tracks[4]]);
    expect(homeGemQuery('unplayed')).toContain('NOT %play_count% GREATER 0');
    expect(homeGemQuery('forgotten')).toContain('26 WEEKS');
  });

  it('距今多久按自然日取天、周、月、年里的一档', () => {
    const now = new Date('2026-10-25T09:00:00').getTime();
    const ago = (at: string) => homeAgo(new Date(at).getTime(), now, 'en');
    expect(ago('2026-10-25T00:30:00')).toBe('today');
    expect(ago('2026-10-24T23:50:00')).toBe('yesterday');
    expect(ago('2026-10-19T12:00:00')).toBe('6 days ago');
    expect(ago('2026-10-18T12:00:00')).toBe('last week');
    expect(ago('2026-09-20T12:00:00')).toBe('last month');
    expect(ago('2025-10-24T12:00:00')).toBe('last year');
    expect(ago('2026-10-26T12:00:00')).toBe('today');
  });
});
