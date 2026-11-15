import type { Track } from 'foo-webview-sdk';
import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  createSwapNeighbors,
  type SwapNeighborsFace,
} from '../../../../src/playback/now-playing/swapNeighbors.ts';
import { startTrackSwap, trackSwapAtom } from '../../../../src/playback/now-playing/trackSwap.ts';
import { entriesOf, type QueueView } from '../../../../src/playback/queue/queueState.ts';
import type { PlaybackState } from '../../../../src/playback/playbackContract.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const rows = ['A', 'B', 'C', 'D', 'E'].map((name, at) =>
  makeTrack({ path: `file://E:/Music/L/${name}.flac`, title: name, trackNumber: at + 1 }),
);
const [a, b, c, d] = rows as [Track, Track, Track, Track, Track];

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 播放列表的一份行；`playing` 给了就把 `getCurrentTrackIndex` 答成它那一行 */
function hostOf(playingRow: () => number | null): SwapNeighborsFace {
  return {
    player: {
      getCurrentTrackIndex: vi.fn(async () => {
        const index = playingRow();
        return index === null
          ? {
              success: true as const,
              found: false,
              playlist: null,
              playlistGuid: null,
              index: null,
            }
          : { success: true as const, found: true, playlist: 0, playlistGuid: '{L}', index };
      }),
    },
    playlist: {
      getTracks: vi.fn(async (_guid: string | number, start = 0, count = 1) => ({
        success: true as const,
        playlist: 0,
        start,
        count: 0,
        total: rows.length,
        tracks: rows.slice(start, start + count).map((row, offset) => ({
          handle: row.handle,
          index: start + offset,
        })),
      })),
    },
  };
}

function setup(order: string | null = 'default', queueHeads: readonly Track[] = []) {
  const store = createStore();
  const queue = atom<QueueView>({
    status: 'ready',
    entries: entriesOf(
      queueHeads.map((track) => ({ ...track, playlist: null, playlistItem: null })),
    ),
  });
  let playing: number | null = null;
  const host = hostOf(() => playing);
  const neighbors = createSwapNeighbors(store, { queue, order: atom(order) }, host);
  return {
    store,
    queue,
    host,
    neighbors,
    at(row: number | null) {
      playing = row;
    },
  };
}

describe('createSwapNeighbors', () => {
  it('默认顺序：新一首是列表里的下一行算下一首，前一行算上一首，别的认不出', async () => {
    const page = setup('default');
    page.at(1);
    page.neighbors.advance(b);
    await wait();
    expect(page.neighbors.guess(c.handle)).toBe('next');
    expect(page.neighbors.guess(a.handle)).toBe('previous');
    expect(page.neighbors.guess(d.handle)).toBeNull();
  });

  it('随机顺序不读列表：下一首认不出，上一首只认刚播过的那一首', async () => {
    const page = setup('random');
    page.at(1);
    page.neighbors.advance(a);
    page.neighbors.advance(b);
    await wait();
    expect(page.host.player.getCurrentTrackIndex).not.toHaveBeenCalled();
    expect(page.neighbors.guess(c.handle)).toBeNull();
    expect(page.neighbors.guess(a.handle)).toBe('previous');
  });

  it('队首算下一首；队列在换曲事件之前就先变了，这一首播放期间出现过的队首都算', async () => {
    const page = setup('random', [d]);
    page.neighbors.advance(a);
    expect(page.neighbors.guess(d.handle)).toBe('next');
    page.store.set(page.queue, { status: 'ready', entries: [] });
    expect(page.neighbors.guess(d.handle)).toBe('next');
    page.neighbors.advance(d);
    expect(page.neighbors.guess(d.handle)).toBeNull();
  });
});

describe('宿主执行的换曲认方向（全局快捷键、媒体键、托盘）', () => {
  type Progress = Pick<PlaybackState, 'track' | 'position' | 'duration'>;

  function swapPage() {
    const page = setup('default');
    const progress = atom<Progress>({ track: a, position: 0, duration: 100 });
    const track = atom((get) => get(progress).track);
    page.at(0);
    const service = startTrackSwap(
      page.store,
      { track, progress, neighbors: page.neighbors },
      () => 1000,
    );
    const play = async (next: Track, row: number) => {
      page.at(row);
      page.store.set(progress, { track: next, position: 0, duration: 100 });
      await wait();
    };
    return { ...page, service, play, swap: () => page.store.get(trackSwapAtom) };
  }

  it('没有按键记录时，新一首正是料到的下一首、上一首，与点键同一个方向；跳播仍是无方向', async () => {
    const page = swapPage();
    await wait();
    await page.play(b, 1);
    expect(page.swap().direction).toBe('next');
    await page.play(c, 2);
    expect(page.swap().direction).toBe('next');
    await page.play(b, 1);
    expect(page.swap().direction).toBe('previous');
    await page.play(d, 3);
    expect(page.swap().direction).toBe('none');
    page.service.dispose();
  });
});
