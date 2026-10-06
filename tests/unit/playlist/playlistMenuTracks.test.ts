import { expect, it, vi } from 'vitest';
import { readPlaylistMenuTracks } from '../../../src/playlist/playlistMenuTracks.ts';
import { HANDLE_PAGE } from '../../../src/playlist/selectionHandles.ts';
import { numberParam } from '../../fixtures/hostAnswers.ts';
import { trackRow } from '../../fixtures/libraryRows.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

it('按选择区间补读未加载行，每页携带自己的评分戳', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', (params) => {
    const start = numberParam(params, 'start') ?? 0;
    const count = numberParam(params, 'count') ?? 0;
    return {
      success: true,
      playlist: 0,
      start,
      count,
      total: 1000,
      tracks: Array.from({ length: count }, (_, at) => ({
        ...trackRow('Album', String(start + at)),
        index: start + at,
      })),
    };
  });
  let stamp = 0;
  const data = await readPlaylistMenuTracks(
    host.fb.playlist,
    'list',
    [
      { start: 0, end: HANDLE_PAGE + 1 },
      { start: 700, end: 701 },
    ],
    () => ++stamp,
    () => true,
  );
  expect(data?.tracks).toHaveLength(HANDLE_PAGE + 2);
  expect(data?.stamps).toEqual([...Array.from({ length: HANDLE_PAGE }, () => 1), 2, 3]);
  expect(host.callsTo('playlist.getTracks').map(({ start, count }) => [start, count])).toEqual([
    [0, HANDLE_PAGE],
    [HANDLE_PAGE, 1],
    [700, 1],
  ]);
});

it('分页读取中目标过期，不返回部分曲目、不继续读取', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', {
    success: true,
    playlist: 0,
    start: 0,
    count: 1,
    total: 3,
    tracks: [{ ...trackRow('Album', 'First'), index: 0 }],
  });
  const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  expect(
    await readPlaylistMenuTracks(
      host.fb.playlist,
      'list',
      [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ],
      () => 1,
      current,
    ),
  ).toBeNull();
  expect(host.callsTo('playlist.getTracks')).toHaveLength(1);
});

it('页长不符不把部分选区当作完整评分对象', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', {
    success: true,
    playlist: 0,
    start: 0,
    count: 0,
    total: 1,
    tracks: [],
  });
  expect(
    await readPlaylistMenuTracks(
      host.fb.playlist,
      'list',
      [{ start: 0, end: 1 }],
      () => 1,
      () => true,
    ),
  ).toBeNull();
});
