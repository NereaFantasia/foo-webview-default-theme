import { createStore } from 'jotai/vanilla';
import { expect, onTestFinished, test } from 'vitest';
import { startColorIntegration } from '../../../src/app/colorIntegration.ts';
import { startPlayback, playbackTrackStatusAtom } from '../../../src/playback/playback.ts';
import {
  accentRampAtom,
  coverProfileAtom,
  COVER_PROFILE_STORAGE_KEY,
} from '../../../src/theme/accentState.ts';
import { tealBrand } from '../../../src/theme/brand.ts';
import {
  backgroundCoverAtom,
  backgroundTransportAtom,
} from '../../../src/theme/background/windowBackground.ts';
import { profileFromPixels } from '../../../src/theme/coverPalette.ts';
import { defer, foundCover } from '../../fixtures/coverArt.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { makeTrack } from '../../fixtures/tracks.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

const BLUE = profileFromPixels(new Uint8ClampedArray([40, 90, 200, 255]));
const RED = profileFromPixels(new Uint8ClampedArray([200, 20, 30, 255]));
const TRACK = makeTrack();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function memory() {
  const values = new Map([
    [COVER_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, profile: BLUE })],
  ]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('连接早于曲目初读时保留首帧缓存，结果到达才直接换色，暂停保留、停止清档', async () => {
  const host = installFakeHost();
  const held = host.hold('playback.getCurrentTrack');
  const color = defer<typeof RED>();
  host.answer('artwork.getFb2kUrlByPath', foundCover(TRACK.handle));
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const storage = memory();
  const service = startColorIntegration(store, {
    host: host.fb,
    storage,
    analysis: { read: () => color.promise },
  });
  onTestFinished(() => {
    service.dispose();
    playback.dispose();
  });
  expect(store.get(coverProfileAtom)).toEqual(BLUE);
  expect(store.get(backgroundCoverAtom).profile).toEqual(BLUE);
  expect(store.get(backgroundTransportAtom)).toBe('pending');
  await playback.ready;
  await flush();
  expect(store.get(playbackTrackStatusAtom)).toBe('pending');
  expect(store.get(coverProfileAtom)).toEqual(BLUE);
  held.respond(0, { success: true, found: true, track: TRACK });
  await flush();
  expect(store.get(playbackTrackStatusAtom)).toBe('ready');
  expect(store.get(coverProfileAtom)).toEqual(BLUE);
  color.resolve(RED);
  await flush();
  expect(store.get(coverProfileAtom)).toBe(RED);
  expect(store.get(backgroundCoverAtom).profile).toBe(RED);
  expect(store.get(backgroundCoverAtom).url).not.toBe('');
  host.emit('playback:paused', { paused: true });
  await flush();
  expect(store.get(coverProfileAtom)).toBe(RED);
  host.emit('playback:stopped', { reason: 'user' });
  await flush();
  expect(store.get(coverProfileAtom)).toBeNull();
  expect(store.get(backgroundCoverAtom)).toEqual({ url: '', profile: null });
  expect(store.get(backgroundTransportAtom)).toBe('stopped');
  expect(store.get(accentRampAtom)).toBe(tealBrand);
  expect(JSON.parse(storage.getItem(COVER_PROFILE_STORAGE_KEY) ?? '{}')).toEqual({
    version: 1,
    profile: null,
  });
});

test('确认无曲目才清缓存；初读失败也会回退，但不伪装成确认无曲目', async () => {
  const host = installFakeHost();
  const held = host.hold('playback.getCurrentTrack');
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const service = startColorIntegration(store, { host: host.fb, storage: memory() });
  onTestFinished(() => {
    service.dispose();
    playback.dispose();
  });
  await playback.ready;
  await flush();
  held.respond(0, hostFailure('INTERNAL_ERROR'));
  await flush();
  expect(store.get(playbackTrackStatusAtom)).toBe('failed');
  expect(store.get(coverProfileAtom)).toBeNull();
  playback.retry();
  await flush();
  held.respond(0, { success: true, found: false });
  await flush();
  expect(store.get(playbackTrackStatusAtom)).toBe('ready');
  expect(store.get(coverProfileAtom)).toBeNull();
});

test('初始化旧应答不能覆盖事件已确认的新曲目', async () => {
  const host = installFakeHost();
  const held = host.hold('playback.getCurrentTrack');
  host.answer('artwork.getFb2kUrlByPath', foundCover(TRACK.handle));
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  const service = startColorIntegration(store, {
    host: host.fb,
    storage: memory(),
    analysis: { read: async () => RED },
  });
  onTestFinished(() => {
    service.dispose();
    playback.dispose();
  });
  await playback.ready;
  host.emit('playback:trackChanged', TRACK);
  await flush();
  expect(store.get(coverProfileAtom)).toBe(RED);
  held.respond(0, { success: true, found: false });
  await flush();
  expect(store.get(coverProfileAtom)).toBe(RED);
});
