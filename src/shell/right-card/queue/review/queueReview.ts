import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../../../host/waitForHost.ts';
import type { Store } from '../../../../kit/store.ts';
import { upNextTrackOf } from '../upNextModel.ts';
import { EMPTY_QUEUE_REVIEW, type ReviewTrack, type QueueReviewView } from './queueReviewModel.ts';

const viewAtom = atom<QueueReviewView>(EMPTY_QUEUE_REVIEW);
export const queueReviewAtom: Atom<QueueReviewView> = atom((get) => get(viewAtom));
export interface QueueReviewFace extends HostReadyFace {
  on: typeof fb.on;
  player: Pick<typeof fb.player, 'getCurrentTrack'>;
}
export interface QueueReviewService {
  readonly ready: Promise<void>;
  dispose(): void;
}

/** 本次运行内的真实播放记录，不受来源列表增删与循环影响，不跨启动持久化。 */
export function startQueueReview(store: Store, host: QueueReviewFace = fb): QueueReviewService {
  store.set(viewAtom, EMPTY_QUEUE_REVIEW);
  const waiter = waitForHost(host);
  const offs: (() => void)[] = [];
  const history = new Map<string, ReviewTrack>();
  let disposed = false;
  let events = 0;
  let identity = 0;
  let current: ReviewTrack | null = null;

  function changed(track: Track | null) {
    if (disposed) return;
    events++;
    // 同曲循环、重复通知仅刷新资料，不制造一次离开／返回。
    if (track && current?.track.handle === track.handle) {
      current = { ...current, track: upNextTrackOf(track) };
      return;
    }
    const previous = store.get(viewAtom);
    const returning = track ? history.get(track.handle) : undefined;
    if (current) {
      history.delete(current.track.handle);
      history.set(current.track.handle, current);
    }
    if (track) history.delete(track.handle);
    current = track
      ? { key: returning?.key ?? `review:${++identity}`, track: upNextTrackOf(track) }
      : null;
    store.set(viewAtom, {
      rows: [...history.values()],
      total: history.size,
      version: previous.version + 1,
      current: track?.handle ?? null,
      direction: returning ? 'backward' : 'forward',
    });
  }

  async function connect() {
    if (!(await waiter.done) || disposed) return;
    offs.push(
      host.on('playback:trackChanged', changed),
      host.on('playback:stopped', ({ reason }) => {
        // 换曲前的中间停止保留当前身份，让下一次实际换曲一次性结算。
        if (reason === 'starting_another') events++;
        else changed(null);
      }),
    );
    const before = events;
    const answer = await settle(() => host.player.getCurrentTrack());
    if (!disposed && events === before && answer?.success === true && answer.track)
      changed(answer.track);
  }
  return {
    ready: connect(),
    dispose() {
      disposed = true;
      waiter.cancel();
      offs.forEach((off) => off());
      history.clear();
    },
  };
}
