import { expect, it, vi } from 'vitest';
import { playPlaylistSelection } from '../../../src/playlist/playPlaylistSelection.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';

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
    await playPlaylistSelection(host.fb, 'list', [{ start: 0, end: 3 }], () => true, play),
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
  expect(await playPlaylistSelection(host.fb, 'list', [{ start: 0, end: 1 }], current, play)).toBe(
    false,
  );
  expect(play).not.toHaveBeenCalled();
});

it('来源变化先于缓存版本发布时作废读取，应答结束后释放订阅', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', hostFailure('OPERATION_FAILED'));
  const held = host.hold('playlist.getTracks');
  const paths: string[][] = [];
  const result = playPlaylistSelection(
    host.fb,
    'list',
    [{ start: 0, end: 1 }],
    () => true,
    async (value) => {
      paths.push([...value]);
      return true;
    },
  );
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  expect(host.listenerCount('playlist:itemsReplaced')).toBe(1);
  host.emit('playlist:itemsReplaced', {
    playlist: 0,
    playlistGuid: 'list',
    count: 1,
    contentVersion: '1',
  });
  held.respond(0, {
    success: true,
    playlist: 0,
    start: 0,
    count: 1,
    total: 1,
    tracks: [{ index: 0, path: 'file://E:/old.flac', subsong: 0 }],
  });
  expect(await result).toBe(false);
  expect(paths).toEqual([]);
  expect(host.listenerCount('playlist:itemsReplaced')).toBe(0);
  expect(host.listenerCount('playlist:removed')).toBe(0);
});

it('其他列表变化不作废当前来源，失败应答也释放订阅', async () => {
  const host = installFakeHost();
  host.answer('playlist.getTracks', hostFailure('OPERATION_FAILED'));
  const held = host.hold('playlist.getTracks');
  const paths: string[][] = [];
  const result = playPlaylistSelection(
    host.fb,
    'list',
    [{ start: 0, end: 1 }],
    () => true,
    async (value) => {
      paths.push([...value]);
      return true;
    },
  );
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  host.emit('playlist:itemsReplaced', {
    playlist: 1,
    playlistGuid: 'other',
    count: 1,
    contentVersion: '1',
  });
  held.respond(0, {
    success: true,
    playlist: 0,
    start: 0,
    count: 1,
    total: 1,
    tracks: [{ index: 0, path: 'file://E:/current.flac', subsong: 0 }],
  });
  expect(await result).toBe(true);
  expect(paths).toEqual([['file://E:/current.flac']]);
  const failed = playPlaylistSelection(
    host.fb,
    'list',
    [{ start: 0, end: 1 }],
    () => true,
    async () => true,
  );
  await vi.waitFor(() => expect(held.pending).toHaveLength(1));
  held.respond(0, hostFailure('OPERATION_FAILED'));
  expect(await failed).toBe(false);
  expect(host.listenerCount('playlist:itemsReplaced')).toBe(0);
  expect(host.listenerCount('playlist:removed')).toBe(0);
});
