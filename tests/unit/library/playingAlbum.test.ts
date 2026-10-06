import type { Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import { albumKeyOf } from '../../../src/host/libraryContract.ts';
import { playbackPausedAtom, playingAlbumKeyAtom } from '../../../src/library/playingAlbum.ts';
import { startPlayback } from '../../../src/playback/playback.ts';
import { albumRow } from '../../fixtures/libraryRows.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

/** 装一台宿主替身、放上这一首，读两个原子。每条测试只调一次。 */
async function withTrack(state: 'playing' | 'paused' | 'stopped', track: Track | null) {
  const host = installFakeHost();
  host.answer('playback.getState', { success: true, state, canSeek: true, canPause: true });
  host.answer(
    'playback.getCurrentTrack',
    track ? { success: true, found: true, track } : { success: true, found: false },
  );
  const store = createStore();
  await startPlayback(store, host.fb).ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { key: store.get(playingAlbumKeyAtom), paused: store.get(playbackPausedAtom) };
}

const MODAL_SOUL = albumKeyOf(albumRow('Modal Soul', 'Nujabes'));

describe('playingAlbumKeyAtom', () => {
  it('装载着的曲目折成专辑键', async () => {
    expect(await withTrack('playing', makeTrack())).toEqual({ key: MODAL_SOUL, paused: false });
  });

  it('暂停时照样算', async () => {
    expect(await withTrack('paused', makeTrack())).toEqual({ key: MODAL_SOUL, paused: true });
  });

  it('album artist 有多个值时取首值，首值本身带「, 」也不拆', async () => {
    const track = makeTrack({
      albumArtist: 'Crosby, Stills, Nash',
      albumArtists: ['Crosby, Stills', 'Nash'],
    });
    const { key } = await withTrack('playing', track);
    expect(key).toBe(albumKeyOf(albumRow('Modal Soul', 'Crosby, Stills')));
  });

  it('没有 album artist 标签时取 artist 首值，与宿主折叠专辑的口径一致', async () => {
    const track = makeTrack({
      albumArtist: '',
      albumArtists: [],
      artist: 'A, B',
      artists: ['A', 'B'],
    });
    const { key } = await withTrack('playing', track);
    expect(key).toBe(albumKeyOf(albumRow('Modal Soul', 'A')));
  });

  it('停止时为 null', async () => {
    expect((await withTrack('stopped', makeTrack())).key).toBeNull();
  });

  it('没有曲目时为 null', async () => {
    expect((await withTrack('playing', null)).key).toBeNull();
  });

  it('曲目没有专辑名时为 null', async () => {
    expect((await withTrack('playing', makeTrack({ album: '' }))).key).toBeNull();
  });
});
