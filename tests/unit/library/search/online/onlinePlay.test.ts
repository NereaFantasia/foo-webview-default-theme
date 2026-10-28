import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  createOnlinePlay,
  ONLINE_PLAY_LIMIT,
  onlineListSource,
  onlineSearchSource,
} from '../../../../../src/library/search/online/onlinePlay.ts';
import type { MusicQuality } from '../../../../../src/server/musicObjects.ts';
import type { TrackActionsService } from '../../../../../src/track/trackActions.ts';
import { musicTrack } from '../../../../fixtures/music.ts';

function setup(port: number | null = 51234, failed = false) {
  const store = createStore();
  const playPaths = vi.fn<TrackActionsService['playPaths']>(async () => true);
  const queuePaths = vi.fn<TrackActionsService['queuePaths']>(async () => true);
  const remember = vi.fn();
  const play = createOnlinePlay(store, {
    port: atom(port),
    failed: atom(failed),
    quality: atom<MusicQuality>('flac'),
    actions: { playPaths, queuePaths },
    tracks: { remember },
  });
  return { play, playPaths, queuePaths, remember };
}

const address = (id: string) => `http://127.0.0.1:51234/music/stream/wy/${id}.flac?q=flac`;

describe('在线曲目起播与入队', () => {
  it('已加载的结果换进专用列表，从所点那首起播，来源记查询词，并预记展示信息', async () => {
    const { play, playPaths, remember } = setup();
    const tracks = ['1', '2', '3'].map((id) => musicTrack(id));
    await expect(play.play(tracks, 1, onlineSearchSource('Nujabes'))).resolves.toBe(true);
    expect(playPaths).toHaveBeenCalledWith([address('1'), address('2'), address('3')], 1, {
      kind: 'online',
      subject: 'Nujabes',
      name: 'Nujabes',
    });
    expect(remember).toHaveBeenCalledWith(tracks);
  });

  it('ID 放不进地址的曲目跳过，序号随之对齐；所点那首放不进时不起播', async () => {
    const { play, playPaths } = setup();
    const tracks = [musicTrack('a/b'), musicTrack('2'), musicTrack('3')];
    await play.play(tracks, 2, onlineSearchSource('q'));
    expect(playPaths).toHaveBeenCalledWith([address('2'), address('3')], 1, expect.anything());
    await expect(play.play(tracks, 0, onlineSearchSource('q'))).resolves.toBe(false);
    expect(playPaths).toHaveBeenCalledTimes(1);
  });

  it('超过上限时只带含所点那首的一段', async () => {
    const { play, playPaths } = setup();
    const tracks = Array.from({ length: ONLINE_PLAY_LIMIT + 10 }, (_, index) =>
      musicTrack(String(index)),
    );
    await play.play(tracks, ONLINE_PLAY_LIMIT + 5, onlineSearchSource('q'));
    const [paths, index] = playPaths.mock.calls[0] ?? [];
    expect(paths).toHaveLength(ONLINE_PLAY_LIMIT);
    expect(paths?.[index ?? -1]).toBe(address(String(ONLINE_PLAY_LIMIT + 5)));
  });

  it('从在线列表起播时来源写列表种类与名字，主体是列表地点的主体', async () => {
    const { play, playPaths } = setup();
    const list = {
      kind: 'artist',
      ref: { platform: 'wy', id: '162138' },
      title: 'Nujabes',
    } as const;
    await play.play([musicTrack('1')], 0, onlineListSource(list));
    expect(playPaths.mock.calls[0]?.[2]).toEqual({
      kind: 'onlineArtist',
      subject: JSON.stringify(['wy', 'artist', '162138', 'Nujabes']),
      name: 'Nujabes',
    });
  });

  it('后端没连上或已判停（端口还留着）时不起播也不入队', async () => {
    for (const env of [setup(null), setup(51234, true)]) {
      await expect(env.play.play([musicTrack('1')], 0, onlineSearchSource('q'))).resolves.toBe(
        false,
      );
      await expect(env.play.queue([musicTrack('1')], true)).resolves.toBe(false);
      expect(env.playPaths).not.toHaveBeenCalled();
      expect(env.queuePaths).not.toHaveBeenCalled();
    }
  });

  it('入队按所给顺序，插到队首或接在队尾', async () => {
    const { play, queuePaths } = setup();
    await play.queue([musicTrack('1'), musicTrack('2')], true);
    await play.queue([musicTrack('3')], false);
    expect(queuePaths.mock.calls).toEqual([
      [[address('1'), address('2')], true],
      [[address('3')], false],
    ]);
  });
});
