import { expect, it } from 'vitest';
import { foldersSort } from '../../../../../src/library/folders/detail/foldersSort.ts';
import { trackRow } from '../../../../fixtures/libraryRows.ts';

const tracks = ['09', '14', '01', '02'].map((number) =>
  trackRow('Videos', '', {
    title: '',
    path: `file-relative://..\\..\\OST\\Videos\\${number}. sample.MP4`,
    absolutePath: `E:\\OST\\Videos\\${number}. sample.MP4`,
    discNumber: 0,
    trackNumber: 0,
  }),
);

it('无标签视频按显示文件名升序和降序排列，不修改输入', () => {
  const original = [...tracks];
  expect(foldersSort(tracks, { column: 'title', descending: false })).toEqual([
    tracks[2],
    tracks[3],
    tracks[0],
    tracks[1],
  ]);
  expect(foldersSort(tracks, { column: 'title', descending: true })).toEqual([
    tracks[1],
    tracks[0],
    tracks[3],
    tracks[2],
  ]);
  expect(tracks).toEqual(original);
});

it('默认目录排序也以显示标题兜底', () => {
  expect(foldersSort(tracks, null)).toEqual([tracks[2], tracks[3], tracks[0], tracks[1]]);
});

it('有标题标签时按标签排序，数字使用自然顺序', () => {
  const two = trackRow('Videos', '2. title', { path: 'E:\\Videos\\99.mp4' });
  const ten = trackRow('Videos', '10. title', { path: 'E:\\Videos\\00.mp4' });
  expect(foldersSort([ten, two], { column: 'title', descending: false })).toEqual([two, ten]);
});

it('扩展字段按值比，同值按目录序；降序只反转所选列，统计缺值按空算', () => {
  const at = (title: string, extra: Parameters<typeof trackRow>[2]) =>
    trackRow('Album', title, { path: `E:\\Music\\${title}.flac`, ...extra });
  const low = at('B', { sampleRate: 44100, trackNumber: 2 });
  const high = at('C', { sampleRate: 96000, trackNumber: 3 });
  const same = at('A', { sampleRate: 44100, trackNumber: 1 });
  expect(foldersSort([high, low, same], { column: 'sampleRate', descending: false })).toEqual([
    same,
    low,
    high,
  ]);
  expect(foldersSort([low, same, high], { column: 'sampleRate', descending: true })).toEqual([
    high,
    same,
    low,
  ]);
  const played = { ...low, playCount: 5, lastPlayed: '2024-05-01 10:00:00' };
  const unplayed = { ...high };
  expect(foldersSort([played, unplayed], { column: 'playCount', descending: false })).toEqual([
    unplayed,
    played,
  ]);
  expect(foldersSort([played, unplayed], { column: 'lastPlayed', descending: true })).toEqual([
    played,
    unplayed,
  ]);
});

it('文件大小、声道与年份按数和原文比，不按字典序', () => {
  const small = trackRow('Album', 'Small', { fileSize: 9_000_000, channels: 2, date: '2001' });
  const big = trackRow('Album', 'Big', { fileSize: 10_000_000, channels: 6, date: '1999-05-01' });
  expect(foldersSort([big, small], { column: 'fileSize', descending: false })).toEqual([
    small,
    big,
  ]);
  expect(foldersSort([big, small], { column: 'channels', descending: false })).toEqual([
    small,
    big,
  ]);
  expect(foldersSort([small, big], { column: 'year', descending: false })).toEqual([big, small]);
});
