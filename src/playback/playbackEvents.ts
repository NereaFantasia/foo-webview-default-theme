import type {
  PlaybackDynamicInfoTrackPayload,
  PlaybackStateChangedPayload,
  PlaybackStoppedPayload,
  PlaybackVolumeChangedPayload,
  Track,
} from 'foo-webview-sdk';
import type { fb } from 'foo-webview-sdk/bridge';

/**
 * 播放事件到状态的映射。事件没带的字段按需重读，不把每条事件当完整快照。
 *
 * 进度以约 100 ms 一拍的 `timeHighRes` 为准。1 Hz 的 `time` 报的是整秒，与它混用会把精确位置每秒往回拽，
 * 所以只在 `HIGH_RES_SILENCE_MS` 内没收到高频进度时才用它（全部窗口隐藏时两者都不发）。
 */
export interface PlaybackEventSink {
  trackChanged(track: Track): void;
  edited(track: Track): void;
  /** 要开始放了，曲目还没打开；随后是 `trackChanged`。 */
  starting(): void;
  /** 网络电台换了一首：只带曲名与艺人。 */
  streamTrack(payload: PlaybackDynamicInfoTrackPayload): void;
  stopped(reason: PlaybackStoppedPayload['reason']): void;
  paused(paused: boolean): void;
  stateChanged(payload: PlaybackStateChangedPayload): void;
  positionChanged(position: number): void;
  volumeChanged(payload: PlaybackVolumeChangedPayload): void;
  /** 载荷只有顺序编号，名字要重读。 */
  orderChanged(): void;
}

/** 高频进度静默多久才让 1 Hz 的 `time` 顶上，毫秒。 */
export const HIGH_RES_SILENCE_MS = 1500;

/** 订十二个播放事件，返回一次全摘的清理函数。`now` 是毫秒时钟，由调用方注入。 */
export function bindPlaybackEvents(
  host: { on: typeof fb.on },
  sink: PlaybackEventSink,
  now: () => number = Date.now,
): () => void {
  let lastHighRes = Number.NEGATIVE_INFINITY;
  const offs = [
    host.on('playback:trackChanged', (track) => sink.trackChanged(track)),
    host.on('playback:edited', (track) => sink.edited(track)),
    host.on('playback:starting', () => sink.starting()),
    host.on('playback:dynamicInfoTrack', (payload) => sink.streamTrack(payload)),
    host.on('playback:stopped', (payload) => sink.stopped(payload.reason)),
    host.on('playback:paused', (payload) => sink.paused(payload.paused)),
    host.on('playback:stateChanged', (payload) => sink.stateChanged(payload)),
    host.on('playback:seeked', (payload) => sink.positionChanged(payload.position)),
    host.on('playback:timeHighRes', (payload) => {
      lastHighRes = now();
      sink.positionChanged(payload.position);
    }),
    host.on('playback:time', (payload) => {
      if (now() - lastHighRes > HIGH_RES_SILENCE_MS) sink.positionChanged(payload.position);
    }),
    host.on('playback:volumeChanged', (payload) => sink.volumeChanged(payload)),
    host.on('playback:orderChanged', () => sink.orderChanged()),
  ];
  return () => {
    for (const off of offs.splice(0)) off();
  };
}
