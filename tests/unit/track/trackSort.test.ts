import { describe, expect, it } from 'vitest';
import {
  isTrackSortColumn,
  nextTrackSort,
  sortFlatTracks,
  startsDescending,
} from '../../../src/track/trackSort.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';

const at = (title: string, sampleRate: number, trackNumber = 1) =>
  trackRow('Album', title, { sampleRate, trackNumber });

describe('sortFlatTracks', () => {
  it('同值保持入参的次序，升降序都一样，不修改输入', () => {
    const [first, second, third] = [at('B', 44100), at('A', 44100), at('C', 96000)];
    const input = [first, second, third];
    expect(sortFlatTracks(input, { column: 'sampleRate', descending: false })).toEqual([
      first,
      second,
      third,
    ]);
    expect(sortFlatTracks(input, { column: 'sampleRate', descending: true })).toEqual([
      third,
      first,
      second,
    ]);
    expect(input).toEqual([first, second, third]);
  });

  it('序号列不跨组混排：升序保持入参的次序，降序整份倒过来', () => {
    const input = [at('A1', 44100, 1), at('A2', 44100, 2), at('B1', 44100, 1)];
    expect(sortFlatTracks(input, { column: 'number', descending: false })).toEqual(input);
    expect(sortFlatTracks(input, { column: 'number', descending: true })).toEqual(
      [...input].reverse(),
    );
  });

  it('没有排序或没有比较方法的列时原样返回副本', () => {
    const input = [at('B', 1), at('A', 2)];
    expect(sortFlatTracks(input, null)).toEqual(input);
    expect(sortFlatTracks(input, null)).not.toBe(input);
    expect(sortFlatTracks(input, { column: 'cover', descending: true })).toEqual(input);
  });
});

describe('列的缺省方向', () => {
  it('年份、评分与添加、播放统计从大的、新的在前起，其余从升序起', () => {
    for (const column of ['year', 'rating', 'added', 'playCount', 'lastPlayed'] as const)
      expect(startsDescending(column)).toBe(true);
    for (const column of ['title', 'artist', 'number', 'duration', 'path'] as const)
      expect(startsDescending(column)).toBe(false);
  });

  it('点列头：同一列反向，换一列取它的缺省方向，不改入参', () => {
    const now = { column: 'title' as const, descending: false };
    expect(nextTrackSort(now, 'title')).toEqual({ column: 'title', descending: true });
    expect(nextTrackSort(now, 'rating')).toEqual({ column: 'rating', descending: true });
    expect(nextTrackSort(null, 'artist')).toEqual({ column: 'artist', descending: false });
    expect(nextTrackSort({ column: 'year', descending: true }, 'year')).toEqual({
      column: 'year',
      descending: false,
    });
    expect(now).toEqual({ column: 'title', descending: false });
  });
});

describe('碟号、文件名、文件夹三列', () => {
  const file = (folder: string, name: string, discNumber = 0) =>
    trackRow('Album', name, { path: `file://E:/Music/${folder}/${name}`, discNumber });

  it('文件名按自然序：数字按大小，同名按路径', () => {
    const [ten, two, other] = [
      file('A', '10 b.flac'),
      file('A', '2 a.flac'),
      file('B', '2 a.flac'),
    ];
    expect(sortFlatTracks([ten, other, two], { column: 'fileName', descending: false })).toEqual([
      other,
      two,
      ten,
    ]);
  });

  it('文件夹按所在文件夹的名字排，降序反过来', () => {
    const [b, a, c] = [file('B', 'x.flac'), file('A', 'x.flac'), file('C', 'x.flac')];
    expect(sortFlatTracks([b, a, c], { column: 'folder', descending: false })).toEqual([a, b, c]);
    expect(sortFlatTracks([b, a, c], { column: 'folder', descending: true })).toEqual([c, b, a]);
  });

  it('碟号按数排', () => {
    const [d10, d2] = [file('A', 'a.flac', 10), file('A', 'b.flac', 2)];
    expect(sortFlatTracks([d10, d2], { column: 'disc', descending: false })).toEqual([d2, d10]);
  });

  it('三列能交给宿主排；要按标签现算的列只显示，不进排序', () => {
    for (const column of ['disc', 'fileName', 'folder'] as const)
      expect(isTrackSortColumn(column)).toBe(true);
    for (const column of ['composer', 'comment', 'lastModified', 'firstPlayed'] as const)
      expect(isTrackSortColumn(column)).toBe(false);
  });
});
