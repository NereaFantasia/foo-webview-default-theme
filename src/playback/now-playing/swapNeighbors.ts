import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import type { Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { Store } from '../../kit/store.ts';
import { playbackOrderAtom } from '../playback.ts';
import { queueViewAtom, type QueueView } from '../queue/queueState.ts';

/** 前后一首能从列表行号推出的两种顺序：默认与列表循环（其余随机、单曲循环） */
const SEQUENTIAL = new Set(['default', 'repeat-playlist']);

export interface SwapNeighborsFace {
  player: Pick<typeof fb.player, 'getCurrentTrackIndex'>;
  playlist: Pick<typeof fb.playlist, 'getTracks'>;
}

export interface SwapNeighborsSources {
  readonly queue: Atom<QueueView>;
  readonly order: Atom<string | null>;
}

/**
 * 换曲前能料到的下一首与上一首。宿主执行的上一首、下一首（全局快捷键、媒体键、托盘）不经过主题，换曲事件里
 * 没有方向，只能看新的一首是不是事先料到的：下一首是队首，或默认与列表循环顺序下列表的下一行；上一首是刚
 * 播过的那一首，或这两种顺序下列表的前一行。随机顺序、跳播料不到，仍是无方向
 *
 * 料想只对眼下这一首有效，换曲时重新准备；队列在换曲事件之前就先变了的情形，用「这一首播放期间出现过的队首」
 * 都算
 */
export interface SwapNeighbors {
  /** `handle` 是不是此前料到的下一首、上一首；都不是为 null */
  guess(handle: string): 'next' | 'previous' | null;
  /** 换到了 `track`（停止是 null）：重新准备下一次换曲的料想 */
  advance(track: Track | null): void;
  dispose(): void;
}

export function createSwapNeighbors(
  store: Store,
  sources: SwapNeighborsSources = { queue: queueViewAtom, order: playbackOrderAtom },
  host: SwapNeighborsFace = fb,
): SwapNeighbors {
  let next = new Set<string>();
  let previous = new Set<string>();
  let shown: string | null = null;
  let generation = 0;
  let disposed = false;

  const rememberQueue = () => {
    const head = store.get(sources.queue).entries[0]?.track.handle;
    if (head) next.add(head);
  };
  const offQueue = store.sub(sources.queue, rememberQueue);

  /** 按列表里的位置补料想：下一行是下一首，前一行是上一首 */
  async function readNeighbors(mine: number): Promise<void> {
    const order = store.get(sources.order);
    if (order === null || !SEQUENTIAL.has(order)) return;
    const stale = () => disposed || mine !== generation;
    const where = await settle(() => host.player.getCurrentTrackIndex());
    if (stale() || where?.success !== true || !where.found) return;
    const { playlistGuid, index } = where;
    if (playlistGuid === null || index === null) return;
    const start = Math.max(0, index - 1);
    const page = await settle(() =>
      host.playlist.getTracks(playlistGuid, start, 3, undefined, ['handle']),
    );
    if (stale() || page?.success !== true) return;
    for (const [offset, track] of page.tracks.entries()) {
      const handle = track.handle;
      if (!handle) continue;
      const row = start + offset;
      if (row === index - 1) previous.add(handle);
      if (row === index + 1) next.add(handle);
    }
  }

  return {
    guess(handle) {
      if (next.has(handle)) return 'next';
      return previous.has(handle) ? 'previous' : null;
    },
    advance(track) {
      generation += 1;
      previous = new Set(shown ? [shown] : []);
      next = new Set();
      shown = track?.handle ?? null;
      if (!track) return;
      rememberQueue();
      void readNeighbors(generation);
    },
    dispose() {
      disposed = true;
      generation += 1;
      offQueue();
    },
  };
}
