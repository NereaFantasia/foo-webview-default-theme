import { createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { playbackAtom, startPlayback } from '../../../src/playback/playback.ts';
import { trackKeyOf } from '../../../src/playback/playbackContract.ts';
import { playingAudibleAtom, playingTrackKeyAtom } from '../../../src/playback/playingTrack.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const FEATHER = makeTrack();

async function playingFeather() {
  const host = installFakeHost();
  host.answer('playback.getState', {
    success: true,
    state: 'playing',
    canSeek: true,
    canPause: true,
  });
  host.answer('playback.getCurrentTrack', { success: true, found: true, track: FEATHER });
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  onTestFinished(() => playback.dispose());
  await playback.ready;
  await settle();
  return { host, store };
}

describe('playingTrack', () => {
  it('放着时报曲目身份并在出声，暂停时身份还在、不出声，停止后身份清空', async () => {
    const { host, store } = await playingFeather();
    expect(store.get(playingTrackKeyAtom)).toBe(trackKeyOf(FEATHER));
    expect(store.get(playingAudibleAtom)).toBe(true);

    host.emit('playback:paused', { paused: true });
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'paused',
      position: 3,
      duration: 175,
      canSeek: true,
    });
    expect(store.get(playingTrackKeyAtom)).toBe(trackKeyOf(FEATHER));
    expect(store.get(playingAudibleAtom)).toBe(false);

    // 宿主真停了：核对停止的那次 getState 答停着。
    host.answer('playback.getState', {
      success: true,
      state: 'stopped',
      canSeek: false,
      canPause: false,
    });
    host.emit('playback:stopped', { reason: 'user' });
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'stopped',
      position: 0,
      duration: 0,
      canSeek: false,
    });
    await settle();
    expect(store.get(playingTrackKeyAtom)).toBe('');
    expect(store.get(playingAudibleAtom)).toBe(false);
  });

  it('状态报停止、曲目还在时也不算在放', async () => {
    const { host, store } = await playingFeather();
    host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'stopped',
      position: 0,
      duration: 0,
      canSeek: false,
    });
    expect(store.get(playbackAtom).track).not.toBeNull();
    expect(store.get(playingTrackKeyAtom)).toBe('');
  });

  it('播放进度更新不叫醒订阅它们的一方', async () => {
    const { host, store } = await playingFeather();
    let woken = 0;
    const offKey = store.sub(playingTrackKeyAtom, () => (woken += 1));
    const offAudible = store.sub(playingAudibleAtom, () => (woken += 1));
    host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 3.2 });
    offKey();
    offAudible();
    expect(store.get(playbackAtom).position).toBe(3.2);
    expect(woken).toBe(0);
  });
});
