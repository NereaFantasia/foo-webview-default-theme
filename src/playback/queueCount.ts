import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 播放队列里有几首：侧边栏图标态在队列图标上点小圆点用。先订 `playback:queueChanged` 再初读
 * `queue.getCount`，事件自带变化之后的长度，直接用；初读的应答晚于任何一次事件到时丢掉，它已经过期。
 * 读失败、没连上宿主都当 0，只是不点圆点。
 */
export interface QueueCountFace extends HostReadyFace {
  on: typeof fb.on;
  queue: Pick<typeof fb.queue, 'getCount'>;
}

const countAtom = atom(0);

export const queueCountAtom: Atom<number> = atom((get) => get(countAtom));

export interface QueueCountService {
  readonly ready: Promise<void>;
  dispose(): void;
}

export function startQueueCount(store: Store, host: QueueCountFace = fb): QueueCountService {
  store.set(countAtom, 0);
  let disposed = false;
  // 收到过事件之后，初读的应答一律作废。
  let heard = false;
  let off: (() => void) | undefined;
  const waiter = waitForHost(host);

  async function connect(): Promise<void> {
    const arrived = await waiter.done;
    if (disposed || !arrived) return;
    off = host.on('playback:queueChanged', ({ count }) => {
      heard = true;
      if (!disposed) store.set(countAtom, count);
    });
    const answer = await settle(() => host.queue.getCount());
    if (disposed || heard || !answer || answer.success === false) return;
    store.set(countAtom, answer.count);
  }

  return {
    ready: connect(),
    dispose() {
      disposed = true;
      waiter.cancel();
      off?.();
    },
  };
}

export const queueCountKey = serviceKey<QueueCountService>('queueCount');
