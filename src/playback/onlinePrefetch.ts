import type { Atom } from 'jotai/vanilla';
import type { Store } from '../kit/store.ts';
import { holdOnlineTrack, type HoldTrack } from '../server/holdTrack.ts';
import { readOnlineAddress } from '../server/onlineAddress.ts';
import { playbackAtom } from './playback.ts';
import { trackKeyOf, type PlaybackState } from './playbackContract.ts';
import { queueViewAtom, type QueueView } from './queue/queueState.ts';
import { upNextAtom } from './queue/upNext.ts';
import type { UpNextView } from './queue/upNextModel.ts';

/** 听满这么久才预取，连续切歌时不白白下载下一首，秒 */
const EARLY_S = 3;
/** 离结尾不到这么久时，按当时的下一首再通知一次，秒 */
const LATE_S = 90;

export interface PrefetchSources {
  readonly state: Atom<Pick<PlaybackState, 'track' | 'state' | 'position' | 'duration'>>;
  readonly queue: Atom<QueueView>;
  readonly upNext: Atom<UpNextView>;
}

/**
 * 在线曲目播放期间，通知后端把下一首下载进内存（`holdOnlineTrack`），换曲时从内存给出，不必等取地址与上游连接。
 * 下一首取队列的队首，队列空时取「接下来」的第一行。随机顺序与单曲循环推算不出下一首，不预取
 *
 * 每首曲目通知两次：听满 `EARLY_S` 秒时一次，离结尾不到 `LATE_S` 秒时一次。通知没有送到不算错误，换曲时照旧现取地址
 */
export function startOnlinePrefetch(
  store: Store,
  sources: PrefetchSources = { state: playbackAtom, queue: queueViewAtom, upNext: upNextAtom },
  hold: HoldTrack = holdOnlineTrack,
): { dispose(): void } {
  let key = '';
  const sent = { early: false, late: false };

  function nextPath(): string | undefined {
    const queued = store.get(sources.queue).entries[0]?.track.path;
    if (queued) return queued;
    const upcoming = store.get(sources.upNext);
    // 换曲后「接下来」重读完才可信，读好之前还是上一首的表，不使用
    return upcoming.refreshing
      ? undefined
      : upcoming.rows.find((row) => row.offset === 0)?.track.path;
  }

  const check = () => {
    const { track, state, position, duration } = store.get(sources.state);
    const now = trackKeyOf(track);
    if (now !== key) {
      key = now;
      sent.early = false;
      sent.late = false;
    }
    if (!track || state !== 'playing' || position < EARLY_S || !readOnlineAddress(track.path))
      return;
    const phase = duration > 0 && duration - position <= LATE_S ? 'late' : 'early';
    if (sent[phase]) return;
    const next = nextPath();
    if (!next) return;
    sent[phase] = true;
    void hold(next);
  };

  return { dispose: store.sub(sources.state, check) };
}
