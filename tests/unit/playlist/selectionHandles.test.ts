import { describe, expect, it } from 'vitest';
import { collectHandles, HANDLE_PAGE } from '../../../src/playlist/selectionHandles.ts';
import { FakePlaylists, guidOf, makePlaylist, makeRow } from '../../fixtures/fakePlaylists.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const MAIN = guidOf(0);

function setup(trackCount: number) {
  const host = installFakeHost();
  const lists = new FakePlaylists(
    host,
    [makePlaylist(0, 'Main', { isActive: true, trackCount })],
    (event, payload) => host.emit(event, payload),
  );
  return { host, lists };
}

describe('collectHandles', () => {
  it('按区间分页取路径与 subsong，只投影这两个字段', async () => {
    const { host, lists } = setup(HANDLE_PAGE + 20);
    const cue = makeRow('Main', 3, { path: 'file://E:/Music/Live.cue', subsong: 4 });
    lists.setTracks(
      MAIN,
      Array.from({ length: HANDLE_PAGE + 20 }, (_, row) =>
        row === 3 ? cue : makeRow('Main', row),
      ),
    );
    const refs = await collectHandles(host.fb.playlist, MAIN, [
      { start: 2, end: 4 },
      { start: 10, end: HANDLE_PAGE + 15 },
    ]);
    expect(refs).toHaveLength(2 + HANDLE_PAGE + 5);
    expect(refs.slice(0, 2)).toStrictEqual([
      { path: 'file://E:/Music/Main/003.flac', subsong: 0 },
      { path: 'file://E:/Music/Live.cue', subsong: 4 },
    ]);
    const calls = host.callsTo('playlist.getTracks');
    expect(calls.map((call) => [call['start'], call['count']])).toStrictEqual([
      [2, 2],
      [10, HANDLE_PAGE],
      [10 + HANDLE_PAGE, 5],
    ]);
    expect(calls.every((call) => call['playlistGuid'] === MAIN)).toBe(true);
    expect(calls[0]?.['fields']).toStrictEqual(['path', 'subsong']);
  });

  it('列表在读的途中变短、或宿主答失败时整批作罢', async () => {
    const { host } = setup(3);
    await expect(collectHandles(host.fb.playlist, MAIN, [{ start: 0, end: 5 }])).rejects.toThrow();
    await expect(
      collectHandles(host.fb.playlist, guidOf(9), [{ start: 0, end: 1 }]),
    ).rejects.toThrow();
  });
});
