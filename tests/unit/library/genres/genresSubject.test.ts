import { expect, it } from 'vitest';
import { buildGenres, EMPTY_GENRE } from '../../../../src/library/genres/genresModel.ts';
import {
  genreEntryOf,
  genreKeys,
  genresSubject,
} from '../../../../src/library/genres/genresSubject.ts';
import { trackRow } from '../../../fixtures/libraryRows.ts';

it('单选主体保持标签名；多选来源去重并可还原，包括没有流派', () => {
  expect(genresSubject(['Jazz', 'Jazz'])).toBe('Jazz');
  expect(genreKeys(genresSubject(['Jazz', EMPTY_GENRE, 'Rock', 'Jazz']))).toEqual([
    'Jazz',
    EMPTY_GENRE,
    'Rock',
  ]);
  for (const invalid of ['\0[]', '\0[1]', '\0["\u0000[bad"]'])
    expect(genreKeys(invalid)).toEqual([invalid]);
});
it('多选来源合并曲目去重；任意一个主体移除即失效，不悄悄变成剩下的流派', () => {
  const track = trackRow('', 'Shared');
  const entries = buildGenres([track], new Map([[track.handle, ['Rock', 'Jazz']]]), []);
  const subject = genresSubject(['Rock', 'Jazz']);
  expect(genreEntryOf(entries, subject)?.tracks).toEqual([track]);
  expect(genreEntryOf(entries.slice(0, 1), subject)).toBeUndefined();
});

it('多选统计按曲目算专辑数，不依赖专辑清单是否已读回', () => {
  const tracks = [trackRow('One', 'A'), trackRow('Two', 'B')];
  const entries = buildGenres(
    tracks,
    new Map([
      [tracks[0]!.handle, ['Rock', 'Jazz']],
      [tracks[1]!.handle, ['Jazz']],
    ]),
    [],
  );
  const entry = genreEntryOf(entries, genresSubject(['Rock', 'Jazz']));
  expect(entry?.tracks).toHaveLength(2);
  expect(entry?.albumCount).toBe(2);
});
