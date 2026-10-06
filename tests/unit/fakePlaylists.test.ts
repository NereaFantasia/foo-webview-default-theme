import { expect, it } from 'vitest';
import type { HostEvent } from '../fixtures/fakeHost.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../fixtures/fakePlaylists.ts';
import { installFakeHost } from '../fixtures/unitHost.ts';

it('列表重排、复制和删除的载荷保留身份，不用当前位置重造 GUID', async () => {
  const host = installFakeHost();
  const events: { event: HostEvent; payload: unknown }[] = [];
  const main = guidOf(70);
  const other = guidOf(80);
  const lists = new FakePlaylists(
    host,
    [
      makePlaylist(0, 'Main', { guid: main, isActive: true }),
      makePlaylist(1, 'Other', { guid: other }),
    ],
    (event, payload) => {
      events.push({ event, payload });
      host.emit(event, payload);
    },
  );
  await host.fb.playlist.reorderPlaylists([1, 0]);
  await host.fb.playlist.setActive(main);
  await host.fb.playlist.rename(main, 'Renamed');
  expect(events).toStrictEqual([
    { event: 'playlist:reordered', payload: { count: 2, guids: [other, main] } },
    { event: 'playlist:activated', payload: { oldIndex: 1, newIndex: 1, newGuid: main } },
    { event: 'playlist:renamed', payload: { index: 1, guid: main, name: 'Renamed' } },
  ]);
  const copy = await host.fb.playlist.duplicate(main);
  expect(copy.success).toBe(true);
  if (copy.success === false) throw new Error(copy.error);
  expect(copy.sourcePlaylistGuid).toBe(main);
  expect(copy.guid).toBe(lists.guid('Renamed (Copy)'));
  expect(copy.guid).not.toBe(main);
  expect(events.slice(-2)).toStrictEqual([
    {
      event: 'playlist:created',
      payload: { index: 2, guid: copy.guid, name: 'Renamed (Copy)' },
    },
    {
      event: 'playlist:itemsAdded',
      payload: { playlist: 2, playlistGuid: copy.guid, start: 0, count: 10 },
    },
  ]);
  await host.fb.playlist.remove(other);
  expect(events.at(-1)).toStrictEqual({
    event: 'playlist:removed',
    payload: { oldCount: 3, newCount: 2, indices: [0], guids: [other] },
  });
  expect(lists.items.map((list) => list.guid)).toEqual([main, copy.guid]);
});
