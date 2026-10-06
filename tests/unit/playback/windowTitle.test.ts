import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlayback } from '../../../src/playback/playback.ts';
import {
  APP_NAME,
  nowPlayingCaption,
  startWindowTitle,
  TITLE_DEBOUNCE_MS,
  type VisibilityFace,
} from '../../../src/playback/windowTitle.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost, type UnitHost } from '../../fixtures/unitHost.ts';

afterEach(() => {
  vi.useRealTimers();
});

function fakeVisibility() {
  let visible = true;
  const listeners = new Set<() => void>();
  const face: VisibilityFace = {
    visible: () => visible,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: boolean) => {
    visible = next;
    for (const listener of listeners) listener();
  };
  return { face, set };
}

async function start(host: UnitHost) {
  vi.useFakeTimers();
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const visibility = fakeVisibility();
  const title = startWindowTitle(store, host.fb, visibility.face);
  await playback.ready;
  await title.ready;
  await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS);
  const titles = () => host.callsTo('window.setTitle').map((params) => params['title']);
  return { title, visibility, titles };
}

const FEATHER = makeTrack();
const SPIRAL = makeTrack({ path: 'file://E:/Music/Spiral.flac', title: 'Spiral', artist: '' });

describe('nowPlayingCaption', () => {
  it('「艺术家 - 标题」，缺艺术家只写标题，都缺或没有曲目时是产品名', () => {
    expect(nowPlayingCaption(FEATHER)).toBe('Nujabes - Feather');
    expect(nowPlayingCaption(SPIRAL)).toBe('Spiral');
    expect(nowPlayingCaption({ artist: '', title: '' })).toBe(APP_NAME);
    expect(nowPlayingCaption(null)).toBe(APP_NAME);
  });
});

describe('startWindowTitle', () => {
  it('连上时写一次；连续换曲只写最后一首；同值不重发', async () => {
    const host = installFakeHost();
    const { titles } = await start(host);
    expect(titles()).toEqual([APP_NAME]);

    host.emit('playback:trackChanged', FEATHER);
    await vi.advanceTimersByTimeAsync(100);
    host.emit('playback:trackChanged', SPIRAL);
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS);
    expect(titles()).toEqual([APP_NAME, 'Spiral']);

    host.emit('playback:edited', { ...SPIRAL, rating: 5 });
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS);
    expect(titles()).toEqual([APP_NAME, 'Spiral']);
  });

  it('恢复可见时不等去抖，立即按当前曲目补写', async () => {
    const host = installFakeHost();
    const { visibility, titles } = await start(host);
    visibility.set(false);
    host.emit('playback:trackChanged', FEATHER);
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(titles()).toEqual([APP_NAME, 'Nujabes - Feather']);
  });

  it('释放时把标题还给产品名', async () => {
    const host = installFakeHost();
    const { title, titles } = await start(host);
    host.emit('playback:trackChanged', FEATHER);
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS);
    title.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(titles()).toEqual([APP_NAME, 'Nujabes - Feather', APP_NAME]);
  });

  it('没连上宿主一次都不写', async () => {
    vi.useFakeTimers();
    const host = installFakeHost({ available: false });
    const store = createStore();
    startWindowTitle(store, host.fb, fakeVisibility().face);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(host.callsTo('window.setTitle')).toEqual([]);
  });
});
