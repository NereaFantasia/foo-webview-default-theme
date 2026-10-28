import { describe, expect, it } from 'vitest';
import {
  nextOnlineSort,
  onlineListRows,
  onlineSort,
  onlineSortFields,
} from '../../../../src/library/online/onlineListRows.ts';
import type { MusicQuality, MusicTrack } from '../../../../src/server/musicObjects.ts';
import { musicTrack } from '../../../fixtures/music.ts';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function track(
  id: string,
  title: string,
  extra: {
    readonly artist?: string;
    readonly album?: string;
    readonly durationMs?: number | null;
    readonly qualities?: readonly MusicQuality[];
  } = {},
): MusicTrack {
  return musicTrack(id, {
    title,
    artists: [{ ref: null, name: extra.artist ?? 'Nujabes' }],
    album: extra.album ? { ref: null, title: extra.album } : null,
    durationMs: extra.durationMs === undefined ? 200_000 : extra.durationMs,
    qualities: extra.qualities ?? ['128k'],
  });
}

const ids = (tracks: readonly MusicTrack[]) => tracks.map((item) => item.ref.id);

describe('在线列表页的曲目行', () => {
  const tracks = [
    track('1', 'Feather', {
      album: 'Modal Soul',
      durationMs: 295_000,
      qualities: ['128k', 'flac'],
    }),
    track('2', 'aruarian dance', { album: 'Samurai Champloo', durationMs: null }),
    track('3', 'Battlecry', { artist: 'Shing02', album: 'Samurai Champloo', durationMs: 232_000 }),
    track('4', 'Feather', { album: 'Modal Soul', durationMs: 295_000, qualities: ['320k'] }),
  ];

  it('缺省是列表顺序，按 # 降序就倒过来', () => {
    expect(ids(onlineListRows(tracks, '', null, collator))).toEqual(['1', '2', '3', '4']);
    expect(ids(onlineListRows(tracks, '', onlineSort('number', true), collator))).toEqual([
      '4',
      '3',
      '2',
      '1',
    ]);
  });

  it('查找不分大小写，每个词都要出现在标题、艺人或专辑里', () => {
    expect(ids(onlineListRows(tracks, 'SAMURAI shing', null, collator))).toEqual(['3']);
    expect(ids(onlineListRows(tracks, '  modal  ', null, collator))).toEqual(['1', '4']);
    expect(onlineListRows(tracks, 'nothing', null, collator)).toEqual([]);
  });

  it('按标题排时值相同的保持列表顺序，降序也不颠倒', () => {
    const ascending = onlineListRows(tracks, '', { column: 'title', descending: false }, collator);
    expect(ids(ascending)).toEqual(['2', '3', '1', '4']);
    const descending = onlineListRows(tracks, '', { column: 'title', descending: true }, collator);
    expect(ids(descending)).toEqual(['1', '4', '3', '2']);
  });

  it('按时长、音质排时，缺值的排在升序最前', () => {
    const byDuration = onlineListRows(tracks, '', onlineSort('duration', false), collator);
    expect(ids(byDuration)).toEqual(['2', '3', '1', '4']);
    const byQuality = onlineListRows(tracks, '', onlineSort('quality', true), collator);
    expect(ids(byQuality)).toEqual(['1', '4', '2', '3']);
  });

  it('只排给定的曲目，不改原数组', () => {
    const before = [...tracks];
    onlineListRows(tracks, '', onlineSort('artist', true), collator);
    expect(tracks).toEqual(before);
  });
});

describe('在线列表页的排序', () => {
  it('列头：点一列升序，再点反向；缺省时点 # 反向，从别的列点回 # 回到缺省', () => {
    expect(nextOnlineSort(null, 'title')).toEqual({ column: 'title', descending: false });
    expect(nextOnlineSort({ column: 'title', descending: false }, 'title')).toEqual({
      column: 'title',
      descending: true,
    });
    expect(nextOnlineSort(null, 'number')).toEqual({ column: 'number', descending: true });
    expect(nextOnlineSort({ column: 'title', descending: true }, 'number')).toBeNull();
  });

  it('字段跟着列走：专辑没有专辑列，都不含封面与 ⋯', () => {
    expect(onlineSortFields('album')).toEqual(['number', 'title', 'artist', 'quality', 'duration']);
    expect(onlineSortFields('list')).toEqual([
      'number',
      'title',
      'artist',
      'album',
      'quality',
      'duration',
    ]);
  });
});
