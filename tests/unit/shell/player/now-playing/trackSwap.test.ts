import type { Track } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it } from 'vitest';
import type { PlaybackState } from '../../../../../src/playback/playbackContract.ts';
import {
  noteSkip,
  sameAlbum,
  SKIP_INTENT_MS,
  startTrackSwap,
  swapOf,
  trackSwapAtom,
} from '../../../../../src/shell/player/now-playing/trackSwap.ts';
import { makeTrack } from '../../../../fixtures/tracks.ts';

const first = makeTrack({ path: 'file://E:/Music/A/01.flac', title: 'One', duration: 200 });
const second = makeTrack({ path: 'file://E:/Music/A/02.flac', title: 'Two', duration: 180 });
const elsewhere = makeTrack({
  path: 'file://E:/Music/B/01.flac',
  album: 'Other',
  title: 'Three',
});
const radio = makeTrack({ path: 'http://radio.example/live', title: 'Song A', duration: 0 });

const quiet = { intent: null, now: 0, position: 10, duration: 200 };

describe('swapOf', () => {
  it('同一首的标签被编辑不算换曲；同一路流报了新曲名算电台换曲', () => {
    expect(swapOf(first, { ...first, title: 'Renamed' }, quiet)).toBeNull();
    expect(swapOf(null, null, quiet)).toBeNull();
    expect(swapOf(radio, { ...radio, title: 'Song B' }, quiet)).toEqual({
      kind: 'refresh',
      direction: 'none',
      sameCover: true,
    });
    expect(swapOf(radio, { ...radio }, quiet)).toBeNull();
  });

  it('从没有到有是起播，从有到没有是停止，都不带方向', () => {
    expect(swapOf(null, first, quiet)).toMatchObject({ kind: 'enter', direction: 'none' });
    expect(swapOf(first, null, quiet)).toMatchObject({ kind: 'leave', direction: 'none' });
  });

  it('方向：新鲜的按键方向优先；否则播到结尾附近算下一首；别的认不出', () => {
    const intent = { direction: 'previous' as const, at: 0, pending: 1 };
    expect(swapOf(first, second, { ...quiet, intent, now: 100 })?.direction).toBe('previous');
    const stale = { ...quiet, intent, now: SKIP_INTENT_MS + 1 };
    expect(swapOf(first, second, stale)?.direction).toBe('none');
    expect(swapOf(first, second, { ...quiet, position: 199 })?.direction).toBe('next');
    expect(swapOf(first, second, { ...quiet, position: 150 })?.direction).toBe('none');
    // 没有时长（网络流）不按结尾算。
    expect(swapOf(radio, first, { ...quiet, position: 5, duration: 0 })?.direction).toBe('none');
  });
});

describe('sameAlbum', () => {
  it('专辑名、专辑艺人与文件夹都相同才算同一张', () => {
    expect(sameAlbum(first, second)).toBe(true);
    expect(sameAlbum(first, elsewhere)).toBe(false);
    expect(sameAlbum(first, { ...second, path: 'file://E:/Music/C/02.flac' })).toBe(false);
    expect(sameAlbum(first, { ...second, albumArtist: 'Someone Else' })).toBe(false);
    expect(sameAlbum({ ...first, album: '' }, { ...second, album: '' })).toBe(false);
  });
});

type Progress = Pick<PlaybackState, 'track' | 'position' | 'duration'>;

function setup(initial: Track | null) {
  const store = createStore();
  const progress = atom<Progress>({
    track: initial,
    position: 0,
    duration: initial?.duration ?? 0,
  });
  const track = atom((get) => get(progress).track);
  let clock = 1000;
  const service = startTrackSwap(store, { track, progress }, () => clock);
  const play = (next: Track | null, position = 0) =>
    store.set(progress, { track: next, position, duration: next?.duration ?? 0 });
  return {
    store,
    service,
    play,
    tick: (position: number) => store.set(progress, (state) => ({ ...state, position })),
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    swap: () => store.get(trackSwapAtom),
  };
}

describe('startTrackSwap', () => {
  it('按上一个曲目最后报的进度认自然接下一首；新一首的进度不算进上一首', () => {
    const page = setup(first);
    page.tick(199);
    page.play(second, 0);
    expect(page.swap()).toMatchObject({ serial: 1, kind: 'track', direction: 'next' });
    expect(page.swap().sameCover).toBe(true);
    page.play(elsewhere, 0);
    expect(page.swap()).toMatchObject({ serial: 2, direction: 'none', sameCover: false });
    page.service.dispose();
  });

  it('连按两下下一首，接着到的两次换曲都往左翻，第三次认不出', () => {
    const page = setup(first);
    noteSkip(page.store, 'next', page.now());
    noteSkip(page.store, 'next', page.now());
    page.play(second);
    expect(page.swap().direction).toBe('next');
    page.play(elsewhere);
    expect(page.swap().direction).toBe('next');
    page.play(first);
    expect(page.swap().direction).toBe('none');
    page.service.dispose();
  });

  it('按键方向过了时限就不用；换了方向重新数', () => {
    const page = setup(first);
    noteSkip(page.store, 'next', page.now());
    page.advance(SKIP_INTENT_MS + 1);
    page.play(second);
    expect(page.swap().direction).toBe('none');
    noteSkip(page.store, 'next', page.now());
    noteSkip(page.store, 'previous', page.now());
    page.play(first);
    expect(page.swap().direction).toBe('previous');
    page.play(second);
    expect(page.swap().direction).toBe('none');
    page.service.dispose();
  });

  it('停止与起播各记一次，时刻取换的那一刻；释放后不再记', () => {
    const page = setup(first);
    page.play(null);
    expect(page.swap()).toMatchObject({ serial: 1, kind: 'leave', at: 1000 });
    page.advance(50);
    page.play(second);
    expect(page.swap()).toMatchObject({ serial: 2, kind: 'enter', at: 1050 });
    page.service.dispose();
    page.play(first);
    expect(page.swap().serial).toBe(2);
  });
});
