import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../../host/waitForHost.ts';
import type { Store } from '../../../kit/store.ts';

export interface QueueStateFace extends HostReadyFace {
  on: typeof fb.on;
  queue: Pick<typeof fb.queue, 'get'>;
}

/** 条目入队时带的列表位置：带的条目播出后，核心从这一行往下接着播。 */
export interface QueueSpot {
  readonly playlist: number;
  readonly row: number;
}

export interface QueueEntry {
  /**
   * 行的身份：句柄加上它是队列里第几次出现这一首（从 0 起）。主题入队会去重，同一首排两次只发生在
   * 别处加进来的队列里；按位置认行的话，队首一被取走所有行都换了身份，选中与焦点就跟丢了。
   */
  readonly key: string;
  readonly track: Track;
  /** 没有列表位置（按路径入队，或原来那一行已经变了）时为 null。 */
  readonly spot: QueueSpot | null;
}

/** 读回的一条：曲目行加上它的列表位置，与 `queue.get` 的条目同形。 */
export type QueueItemLike = Track & {
  readonly playlist: number | null;
  readonly playlistItem: number | null;
};

export type QueueStatus = 'connecting' | 'ready' | 'failed' | 'disconnected';

export interface QueueView {
  readonly status: QueueStatus;
  /** 按播放顺序；第 0 条是下一首。 */
  readonly entries: readonly QueueEntry[];
}

const INITIAL: QueueView = { status: 'connecting', entries: [] };
const viewAtom = atom<QueueView>(INITIAL);

export const queueViewAtom: Atom<QueueView> = atom((get) => get(viewAtom));

/** 按出现次数给句柄编号，同一份队列每次读回编出的身份相同。 */
export function entriesOf(items: readonly QueueItemLike[]): QueueEntry[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const nth = seen.get(item.handle) ?? 0;
    seen.set(item.handle, nth + 1);
    const spot =
      item.playlist !== null && item.playlistItem !== null
        ? { playlist: item.playlist, row: item.playlistItem }
        : null;
    return { key: `${item.handle}#${nth}`, track: item, spot };
  });
}

/** 去掉队首，剩下的重新编号：被摘掉的那首后面若还排着一份，它成了第 0 次出现。 */
function dropHead(entries: readonly QueueEntry[]): QueueEntry[] {
  return entriesOf(
    entries.slice(1).map((entry) => ({
      ...entry.track,
      playlist: entry.spot?.playlist ?? null,
      playlistItem: entry.spot?.row ?? null,
    })),
  );
}

export interface QueueStateService {
  /** 宿主就绪、订阅好、初读答完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /**
   * 现读一次整份队列，命令按它把行的身份换成下标。读失败、应答过期，或读回仍含已播放的队首时答 null，
   * 调用方不能据此修改队列。只有最后发出的那次读会写进原子；显示时仍提前摘掉已播放的队首。
   */
  refresh(): Promise<readonly QueueEntry[] | null>;
  dispose(): void;
}

/**
 * 播放队列的内容。先订 `playback:queueChanged` 与 `playback:trackChanged` 再初读 `queue.get`；队列变了就整份
 * 重读（事件只带长度，长度为 0 时不必读），几次读同时在路上时只有最后发出的那次写进原子。
 *
 * 核心在曲目结束前约 0.6 秒就定下下一首，队首被取走的通知要在换曲后几十毫秒才到。所以换曲事件里的新曲目
 * 正是队首时先把它摘掉，并记下它：通知到之前读回的队列，队首还是它的也照样摘掉；`playback_advance` 的通知
 * 一到就不再摘，之后读回的队首若还是它，那是同一首排了两次。
 */
export function startQueueState(store: Store, host: QueueStateFace = fb): QueueStateService {
  store.set(viewAtom, INITIAL);
  let disposed = false;
  let generation = 0;
  // 换曲时摘掉的队首句柄，等宿主报出取走了它为止。
  let consumed: string | null = null;
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);

  const write = (patch: Partial<QueueView>) => {
    if (!disposed) store.set(viewAtom, { ...store.get(viewAtom), ...patch });
  };

  const settled = (entries: QueueEntry[]): QueueEntry[] =>
    consumed !== null && entries[0]?.track.handle === consumed ? dropHead(entries) : entries;

  async function read(): Promise<readonly QueueEntry[] | null> {
    const mine = ++generation;
    const answer = await settle(() => host.queue.get());
    if (disposed) return null;
    if (answer?.success !== true) {
      if (mine === generation && store.get(viewAtom).status === 'connecting') {
        write({ status: 'failed' });
      }
      return null;
    }
    const snapshot = entriesOf(answer.items);
    const entries = settled(snapshot);
    if (mine === generation) write({ status: 'ready', entries });
    // 提前摘掉队首只用于显示；宿主下标尚未同步时，本次命令须停止。
    return mine === generation && entries === snapshot ? entries : null;
  }

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      write({ status: 'disconnected' });
      return;
    }
    offs.push(
      host.on('playback:queueChanged', ({ origin, count }) => {
        if (origin === 'playback_advance') consumed = null;
        if (count > 0) {
          void read();
          return;
        }
        generation++;
        write({ status: 'ready', entries: [] });
      }),
      host.on('playback:trackChanged', (track) => {
        const { entries } = store.get(viewAtom);
        if (entries[0]?.track.handle !== track.handle) return;
        consumed = track.handle;
        write({ entries: dropHead(entries) });
      }),
    );
    await read();
  }

  return {
    ready: connect(),
    refresh: read,
    dispose() {
      disposed = true;
      waiter.cancel();
      for (const off of offs.splice(0)) off();
    },
  };
}
