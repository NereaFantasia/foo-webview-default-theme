import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { startListIndex } from '../../../src/playlist/playlistListIndex.ts';
import { playlistsAtom, startPlaylists } from '../../../src/playback/playlists.ts';
import { FakePlaylists, guidOf, makePlaylist } from '../../fixtures/fakePlaylists.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startListIndex', () => {
  it('清单读回之前、建删重排之后到下一次读回之前答 null；其余按此刻的清单换回 GUID', async () => {
    const host = installFakeHost();
    const fake = new FakePlaylists(
      host,
      [makePlaylist(0, 'Main'), makePlaylist(1, 'Other')],
      (event, payload) => host.emit(event, payload),
    );
    const store = createStore();
    const index = startListIndex(store, host.fb);
    expect(index.guidAt(0)).toBeNull();
    const playlists = startPlaylists(store, host.fb);
    await playlists.ready;
    await wait();
    expect(index.guidAt(1)).toBe(guidOf(1));
    expect(index.guidAt(5)).toBeUndefined();
    const held = host.hold('playlist.getAll');
    await host.fb.playlist.create('New');
    expect(index.guidAt(1)).toBeNull();
    held.release();
    await wait();
    await wait();
    expect(store.get(playlistsAtom).items).toHaveLength(3);
    expect(index.guidAt(2)).toBe(fake.guid('New'));
    index.dispose();
    await host.fb.playlist.remove(guidOf(0));
    expect(index.guidAt(0)).not.toBeNull();
  });
});
