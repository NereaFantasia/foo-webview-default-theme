import { expect, it, vi } from 'vitest';
import { playPlaylistSelection } from '../../../src/playlist/playPlaylistSelection.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

it('播放所选保留重复次数与 subsong，不沿原列表播放未选曲目', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', {
    success: true,
    playlist: 0,
    start: 0,
    count: 3,
    total: 10,
    tracks: [
      { index: 0, path: 'file://E:/a.flac', subsong: 1 },
      { index: 1, path: 'file://E:/a.flac', subsong: 1 },
      { index: 2, path: 'file://E:/a.flac', subsong: 2 },
    ],
  });
  const play = vi.fn(async () => true);
  expect(
    await playPlaylistSelection(host.fb.playlist, 'list', [{ start: 0, end: 3 }], () => true, play),
  ).toBe(true);
  expect(play).toHaveBeenCalledWith([
    'file://E:/a.flac|subsong:1',
    'file://E:/a.flac|subsong:1',
    'file://E:/a.flac|subsong:2',
  ]);
});

it('读取过程中对象失效时不开始播放', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', {
    success: true,
    playlist: 0,
    start: 0,
    count: 1,
    total: 1,
    tracks: [{ index: 0, path: 'file://E:/a.flac', subsong: 0 }],
  });
  let valid = true;
  const current = () => {
    const result = valid;
    valid = false;
    return result;
  };
  const play = vi.fn(async () => true);
  expect(
    await playPlaylistSelection(host.fb.playlist, 'list', [{ start: 0, end: 1 }], current, play),
  ).toBe(false);
  expect(play).not.toHaveBeenCalled();
});
