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
