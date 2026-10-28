import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { MusicClient } from '../../../src/playback/musicClient.ts';
import {
  onlineTracksAtom,
  startOnlineTracks,
  withOnlineTrack,
} from '../../../src/playback/onlineTracks.ts';
import type { MusicTrack } from '../../../src/server/musicObjects.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

const INFO: MusicTrack = {
  ref: { platform: 'wy', id: '64317' },
  title: '因为爱情',
  subtitle: null,
  artists: [
    { ref: { platform: 'wy', id: '2116' }, name: '陈奕迅' },
    { ref: { platform: 'wy', id: '9621' }, name: '王菲' },
  ],
  album: { ref: null, title: 'Stranger Under My Skin' },
  durationMs: 218277,
  artwork: null,
  qualities: ['128k', '320k'],
  access: 'vip',
};
const PATH = 'http://127.0.0.1:51234/music/stream/wy/64317.mp3?q=320k';

/** 等替身在微任务里答完、服务把应答写进状态。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(tracks: MusicClient['tracks']) {
  const store = createStore();
  const client = { tracks: vi.fn(tracks) };
  const service = startOnlineTracks(store, client);
  onTestFinished(() => service.dispose());
  return { store, client, service, info: () => store.get(onlineTracksAtom) };
}

describe('在线曲目的展示信息', () => {
  it('盖上曲名、艺人与专辑；时长以宿主读到的为准，没读到时用上游的', () => {
    const tracks = new Map([['wy:64317', INFO]]);
    const tagged = makeTrack({ path: PATH, title: PATH, artist: '', artists: [], duration: 0 });
    expect(withOnlineTrack(tagged, tracks)).toMatchObject({
      title: '因为爱情',
      artist: '陈奕迅, 王菲',
      artists: ['陈奕迅', '王菲'],
      album: 'Stranger Under My Skin',
      duration: 218.277,
      path: PATH,
    });
    expect(withOnlineTrack({ ...tagged, duration: 217.5 }, tracks).duration).toBe(217.5);
  });

  it('不是在线曲目、还没取到或后端答没有时原样交回', () => {
    const local = makeTrack();
    const tagged = makeTrack({ path: PATH, title: PATH });
    expect(withOnlineTrack(local, new Map([['wy:64317', INFO]]))).toBe(local);
    expect(withOnlineTrack(tagged, new Map())).toBe(tagged);
    expect(withOnlineTrack(tagged, new Map([['wy:64317', null]]))).toBe(tagged);
  });

  it('按平台分批取，每批最多 100 首；取过的与正在取的不重取，没有的记成 null', async () => {
    const { client, service, info } = setup(async (input) =>
      input.ids
        .filter((id) => id !== '2')
        .map((id) => ({ ...INFO, ref: { platform: input.platform, id } })),
    );
    const ids = Array.from({ length: 150 }, (_, index) => String(index + 1));
    service.want([
      ...ids.map((id) => ({ platform: 'wy' as const, id })),
      { platform: 'tx', id: '000l6b9v0OZO45' },
    ]);
    service.want([{ platform: 'wy', id: '1' }]);
    await settle();
    expect(client.tracks.mock.calls.map(([input]) => [input.platform, input.ids.length])).toEqual([
      ['wy', 100],
      ['wy', 50],
      ['tx', 1],
    ]);
    expect(info().get('wy:1')?.title).toBe('因为爱情');
    expect(info().get('wy:2')).toBeNull();
    expect(info().get('tx:000l6b9v0OZO45')?.ref.platform).toBe('tx');
    service.want([{ platform: 'wy', id: '2' }]);
    expect(client.tracks).toHaveBeenCalledTimes(3);
  });

  it('取不到时不记成没有，下次再要会重取', async () => {
    const { client, service, info } = setup(async () => {
      throw new Error('后端暂不可用');
    });
    service.want([{ platform: 'wy', id: '64317' }]);
    await settle();
    expect(info().has('wy:64317')).toBe(false);
    client.tracks.mockResolvedValueOnce([INFO]);
    service.want([{ platform: 'wy', id: '64317' }]);
    await settle();
    expect(info().get('wy:64317')?.title).toBe('因为爱情');
  });

  it('后端还没连上时取不到的，连上后自己再取一次，不等页面再要', async () => {
    const store = createStore();
    const port = atom<number | null>(null);
    const client = {
      tracks: vi.fn<MusicClient['tracks']>(async () => {
        throw new Error('本地后端尚未连接');
      }),
    };
    const service = startOnlineTracks(store, client, port);
    onTestFinished(() => service.dispose());
    service.want([{ platform: 'wy', id: '64317' }]);
    await settle();
    expect(store.get(onlineTracksAtom).has('wy:64317')).toBe(false);
    client.tracks.mockResolvedValue([INFO]);
    store.set(port, 51234);
    await settle();
    expect(store.get(onlineTracksAtom).get('wy:64317')?.title).toBe('因为爱情');
    expect(client.tracks).toHaveBeenCalledTimes(2);
    // 已取到的不因换端口重取。
    store.set(port, 51235);
    await settle();
    expect(client.tracks).toHaveBeenCalledTimes(2);
  });

  it('手上已有的展示信息直接记下，之后不再向后端要', async () => {
    const { client, service, info } = setup(async () => []);
    service.remember([INFO]);
    expect(info().get('wy:64317')?.title).toBe('因为爱情');
    service.want([{ platform: 'wy', id: '64317' }]);
    await settle();
    expect(client.tracks).not.toHaveBeenCalled();
  });
});
