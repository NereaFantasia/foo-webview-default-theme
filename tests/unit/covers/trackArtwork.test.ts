import { createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { createTrackArtwork } from '../../../src/covers/trackArtwork.ts';
import { startOnlineTracks } from '../../../src/playback/onlineTracks.ts';
import { musicTrack } from '../../fixtures/music.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const ONLINE = 'http://127.0.0.1:51234/music/stream/wy/64317.flac?q=flac';
const COVER = 'https://p1.music.126.net/a/109951.jpg';

function setup() {
  const host = installFakeHost();
  host.answer('artwork.getFb2kUrlByPath', (params) => ({
    success: true,
    available: true,
    type: 'front',
    path: String(params['path']),
    dataUrl: `fb2k://artwork/?path=${String(params['path'])}`,
  }));
  const store = createStore();
  const online = startOnlineTracks(store, { tracks: async () => [] });
  const want = vi.fn();
  const artwork = createTrackArtwork(store, { want }, host.fb);
  return { host, online, want, artwork };
}

describe('取曲目封面', () => {
  it('本地曲目原样问宿主', async () => {
    const { host, artwork } = setup();
    const answer = await artwork.urlOf('file://E:/a.flac', 'front', { maxSize: 96 });
    expect(answer).toMatchObject({ success: true, available: true });
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toHaveLength(1);
  });

  it('在线曲目不问宿主，答按设备像素取档的上游封面；只有正面', async () => {
    const { host, online, artwork } = setup();
    online.remember([musicTrack('64317', { artwork: COVER })]);
    expect(await artwork.urlOf(ONLINE, 'front', { maxSize: 96 })).toMatchObject({
      success: true,
      available: true,
      dataUrl: `${COVER}?param=128y128`,
    });
    expect(await artwork.urlOf(ONLINE, 'front', { maxSize: 300 })).toMatchObject({
      dataUrl: `${COVER}?param=512y512`,
    });
    expect(await artwork.urlOf(ONLINE, 'back')).toMatchObject({ available: false, dataUrl: '' });
    expect(host.callsTo('artwork.getFb2kUrlByPath')).toEqual([]);
  });

  it('展示信息还没到时先要再等；后端答没有这一首时答不可用', async () => {
    const { online, want, artwork } = setup();
    const pending = artwork.urlOf(ONLINE);
    expect(want).toHaveBeenCalledWith([{ platform: 'wy', id: '64317' }]);
    online.remember([musicTrack('64317', { artwork: COVER })]);
    expect(await pending).toMatchObject({ available: true, dataUrl: COVER });
    const gone = 'http://127.0.0.1:51234/music/stream/wy/1.flac?q=flac';
    const missing = artwork.urlOf(gone);
    online.remember([musicTrack('1', { artwork: null })]);
    expect(await missing).toMatchObject({ available: false });
  });

  it('等不到展示信息时到上限就答不可用', async () => {
    vi.useFakeTimers();
    const { artwork } = setup();
    const pending = artwork.urlOf(ONLINE);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ available: false });
    vi.useRealTimers();
  });
});
