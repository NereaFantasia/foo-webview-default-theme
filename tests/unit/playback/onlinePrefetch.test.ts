import type { Track } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startOnlinePrefetch } from '../../../src/playback/onlinePrefetch.ts';
import type { PlaybackState } from '../../../src/playback/playbackContract.ts';
import type { QueueView } from '../../../src/playback/queue/queueState.ts';
import { EMPTY_UP_NEXT, type UpNextView } from '../../../src/playback/queue/upNextModel.ts';
import type { HoldTrack } from '../../../src/server/holdTrack.ts';
import { onlineAddress } from '../../../src/server/onlineAddress.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

const online = (id: string): string => {
  const path = onlineAddress(5000, { platform: 'wy', id }, '320k');
  if (!path) throw new Error('占位地址放不下这个 ID');
  return path;
};

type Progress = Pick<PlaybackState, 'track' | 'state' | 'position' | 'duration'>;

function setup(playing: Track | null = makeTrack({ path: online('1') })) {
  const store = createStore();
  const state = atom<Progress>({ track: playing, state: 'playing', position: 0, duration: 200 });
  const queue = atom<QueueView>({ status: 'ready', entries: [] });
  const upNext = atom<UpNextView>(EMPTY_UP_NEXT);
  const hold = vi.fn<HoldTrack>(async () => {});
  const service = startOnlinePrefetch(store, { state, queue, upNext }, hold);
  const at = (patch: Partial<Progress>) => store.set(state, { ...store.get(state), ...patch });
  const enqueue = (path: string) =>
    store.set(queue, {
      status: 'ready',
      entries: [{ key: `${path}#0`, track: makeTrack({ path }), spot: null }],
    });
  const rows = (items: readonly { offset: number; path: string }[], refreshing = false) =>
    store.set(upNext, {
      ...EMPTY_UP_NEXT,
      refreshing,
      rows: items.map((item) => ({
        key: `r${item.offset}`,
        row: item.offset,
        offset: item.offset,
        track: makeTrack({ path: item.path }),
      })),
    });
  return { store, state, hold, service, at, enqueue, rows };
}

describe('startOnlinePrefetch', () => {
  it('听满 3 秒通知后端预取队首那一首，离结尾不到 90 秒再通知一次，每个阶段只发一次', () => {
    const { hold, at, enqueue, service } = setup();
    enqueue(online('2'));
    at({ position: 1 });
    expect(hold).not.toHaveBeenCalled();
    at({ position: 4 });
    at({ position: 5 });
    expect(hold.mock.calls).toEqual([[online('2')]]);
    at({ position: 120 });
    at({ position: 130 });
    expect(hold.mock.calls).toEqual([[online('2')], [online('2')]]);
    service.dispose();
  });

  it('队列空时预取「接下来」的第一行；「接下来」正在重读或第一行还没读到时不预取', () => {
    const { hold, at, rows, service } = setup();
    // 进度每隔一阵更新一次，「接下来」读好后下一次更新才会预取
    at({ position: 10 });
    rows([{ offset: 0, path: online('1') }], true);
    at({ position: 11 });
    rows([{ offset: 7, path: online('9') }]);
    at({ position: 12 });
    expect(hold).not.toHaveBeenCalled();
    rows([
      { offset: 1, path: online('3') },
      { offset: 0, path: online('2') },
    ]);
    at({ position: 13 });
    expect(hold.mock.calls).toEqual([[online('2')]]);
    service.dispose();
  });

  it('换曲后重新计数，新的曲目照样预取', () => {
    const { hold, at, enqueue, service } = setup();
    enqueue(online('2'));
    at({ position: 10 });
    at({ track: makeTrack({ path: online('2') }), position: 0 });
    at({ position: 10 });
    expect(hold).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it('暂停、停止、播放本地曲目时不预取', () => {
    const local = setup(makeTrack({ path: 'file://E:/Music/a.flac' }));
    local.enqueue(online('2'));
    local.at({ position: 10 });
    expect(local.hold).not.toHaveBeenCalled();
    local.service.dispose();

    const paused = setup();
    paused.enqueue(online('2'));
    paused.at({ state: 'paused', position: 10 });
    paused.at({ state: 'stopped', track: null });
    expect(paused.hold).not.toHaveBeenCalled();
    paused.service.dispose();
  });
});
