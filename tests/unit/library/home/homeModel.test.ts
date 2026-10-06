import { describe, expect, it } from 'vitest';
import {
  homeGemQuery,
  homeStatistics,
  sampleHomeAlbums,
  type HomePlaycountRow,
} from '../../../../src/library/home/homeModel.ts';
import { trackPathOf } from '../../../../src/host/libraryContract.ts';
import { albumRow, albumTrackRow } from '../../../fixtures/libraryRows.ts';

describe('首页专辑与统计', () => {
  it('限时不截曲目、排除未知时长，抽样按专辑而不是曲目数', () => {
    const albums = [
      albumRow('Unknown', 'A', { duration: 0 }),
      albumRow('Short', 'A', { duration: 1800, trackCount: 100 }),
      albumRow('Long', 'A', { duration: 1801, trackCount: 1 }),
    ];
    expect(sampleHomeAlbums(albums, 30)).toEqual([albums[1]]);
    expect(sampleHomeAlbums(albums, 0, 1, () => 0)).toEqual([albums[2]]);
    expect(sampleHomeAlbums(albums, 0, 1, () => 0.999)).toEqual([albums[0]]);
    expect(sampleHomeAlbums([], 0)).toEqual([]);
  });

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
    expect(result.recent).toEqual([albums[0], albums[1]]);
    expect(result.added).toEqual([albums[1], albums[0]]);
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
    expect(result.forgotten.map(({ track }) => track)).toEqual([tracks[0]]);
    expect(result.unplayed.map(({ track }) => track)).toEqual([tracks[2], tracks[4]]);
    expect(homeGemQuery('unplayed')).toContain('NOT %play_count% GREATER 0');
    expect(homeGemQuery('forgotten')).toContain('26 WEEKS');
  });
});
