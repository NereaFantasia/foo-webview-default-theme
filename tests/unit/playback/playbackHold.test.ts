import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playbackAtom, startPlayback } from '../../../src/playback/playback.ts';
import { trackKeyOf } from '../../../src/playback/playbackContract.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const at = (port: number, id: string, quality: string) =>
  `http://127.0.0.1:${port}/music/stream/wy/${id}.mp3?q=${quality}`;
const ONLINE = makeTrack({ path: at(51234, '7', '128k'), duration: 200 });
const BETTER = makeTrack({ path: at(51234, '7', '320k'), duration: 0 });
const OTHER = makeTrack({ path: at(51234, '8', '128k'), duration: 180 });

function playingOnline(host: UnitHost): void {
  host.answer('playback.getState', {
    success: true,
    state: 'playing',
    canSeek: true,
    canPause: true,
  });
  host.answer('playback.getCurrentTrack', { success: true, found: true, track: ONLINE });
  host.answer('playback.getPosition', {
    hostTime: Date.now(),
    success: true,
    position: 29.6,
    duration: 200,
    subsong: 0,
    path: ONLINE.path,
  });
}

async function start(host: UnitHost) {
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  await playback.ready;
  await settle();
  return { playback, state: () => store.get(playbackAtom) };
}

/** fb2k 起播队首那一项：报换曲停止、新曲目、从 0 起的状态与进度。 */
function arrive(host: UnitHost, track: typeof BETTER): void {
  host.emit('playback:stopped', { reason: 'starting_another' });
  host.emit('playback:trackChanged', track);
  host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: 0,
    duration: 0,
    canSeek: true,
  });
  host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 0 });
}

describe('在线曲目换地址续播时停住进度', () => {
  it('同一首在线曲目换音质、换端口仍是同一首；本地曲目照旧按路径', () => {
    expect(trackKeyOf(ONLINE)).toBe(trackKeyOf(BETTER));
    expect(trackKeyOf(ONLINE)).toBe(trackKeyOf({ path: at(60000, '7', 'flac'), subsong: 0 }));
    expect(trackKeyOf(ONLINE)).not.toBe(trackKeyOf(OTHER));
    expect(trackKeyOf({ path: 'file://E:/a.flac', subsong: 2 })).toBe('file://E:/a.flac|2');
  });

  it('停在给的位置、不能拖动；换到同一首的新地址不算换曲，跳回后等进度越过跳转点才交回', async () => {
    const host = installFakeHost();
    playingOnline(host);
    const { playback, state } = await start(host);
    const generation = state().trackGeneration;

    const release = playback.holdPosition(30);
    expect(state()).toMatchObject({ position: 30, resuming: true, canSeek: false });
    arrive(host, BETTER);
    expect(state()).toMatchObject({ position: 30, duration: 200, resuming: true, canSeek: false });
    expect(state().track?.path).toBe(BETTER.path);
    expect(state().trackGeneration).toBe(generation);

    release(true);
    host.emit('playback:seeked', { hostTime: Date.now(), position: 30 });
    host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 30.1 });
    expect(state()).toMatchObject({ position: 30, resuming: true });
    host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 30.4 });
    expect(state()).toMatchObject({ position: 30.4, resuming: false, canSeek: true });
    await settle();
    expect(state().trackGeneration).toBe(generation);
    playback.dispose();
  });

  it('宿主进度一直不走，到时限也交回，回读真实位置', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = installFakeHost();
    playingOnline(host);
    const store = createStore();
    const playback = startPlayback(store, host.fb);
    await vi.runAllTimersAsync();
    const release = playback.holdPosition(30);
    arrive(host, BETTER);
    release(true);
    host.answer('playback.getPosition', {
      hostTime: Date.now(),
      success: true,
      position: 30,
      duration: 200,
      subsong: 0,
      path: BETTER.path,
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(store.get(playbackAtom).resuming).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.get(playbackAtom)).toMatchObject({ resuming: false, position: 30 });
    playback.dispose();
  });

  it('跳不回去时立即交回真实位置', async () => {
    const host = installFakeHost();
    playingOnline(host);
    const { playback, state } = await start(host);
    const release = playback.holdPosition(30);
    arrive(host, BETTER);
    host.answer('playback.getPosition', {
      hostTime: Date.now(),
      success: true,
      position: 0.2,
      duration: 200,
      subsong: 0,
      path: BETTER.path,
    });
    release(false);
    expect(state()).toMatchObject({ resuming: false, canSeek: true });
    await settle();
    expect(state().position).toBe(0.2);
    playback.dispose();
  });

  it('停住期间换到别的曲目或停止：结束停住，照常换曲', async () => {
    const host = installFakeHost();
    playingOnline(host);
    const { playback, state } = await start(host);
    const generation = state().trackGeneration;
    const release = playback.holdPosition(30);
    host.emit('playback:trackChanged', OTHER);
    expect(state()).toMatchObject({ resuming: false, position: 0, duration: 180 });
    expect(state().trackGeneration).toBe(generation + 1);
    release(true);
    expect(state().resuming).toBe(false);

    playback.holdPosition(10);
    host.answer('playback.getState', {
      success: true,
      state: 'stopped',
      canSeek: false,
      canPause: false,
    });
    host.emit('playback:stopped', { reason: 'user' });
    expect(state().resuming).toBe(false);
    await settle();
    expect(state()).toMatchObject({ state: 'stopped', track: null });
    playback.dispose();
  });
});
