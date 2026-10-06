import type { Track } from 'foo-webview-sdk';
import { createStore } from 'jotai/vanilla';
import { startPlayback } from '../../src/playback/playback.ts';
import type { PlaybackService } from '../../src/playback/playbackContract.ts';
import type { Store } from '../../src/kit/store.ts';
import { installFakeHost, type UnitHost, type UnitHostOptions } from './unitHost.ts';

// 沉浸视图各服务的单测都要一首「正在播放」的曲目：装一台宿主替身，起真的播放服务，
// 换曲、停止与进度都照宿主的样子推事件，服务读到的 `currentTrackAtom`、`playbackAtom` 就是真的。

/**
 * 让排着的微任务与 setImmediate 回调跑完几轮。只经 setImmediate，与
 * `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` 同用时不会卡住。
 */
export async function flush(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export interface PlayingTrack {
  readonly host: UnitHost;
  readonly store: Store;
  readonly playback: PlaybackService;
  /** 宿主报换曲（`playback:trackChanged`），此后问状态答在放；同一首再报一次，曲目身份不变。 */
  play(track: Track): void;
  /** 宿主报编辑了正在播放的那一首（`playback:edited`）。 */
  edit(track: Track): void;
  /** 宿主报用户停止，此后问状态也答停着：播放服务核对过后清空当前曲目。 */
  stop(): void;
  /** 宿主报进度（`playback:seeked`），秒。 */
  seek(position: number): void;
}

/** 换曲与停止之后宿主答的状态，与事件对得上。 */
const PLAYING = { success: true, state: 'playing', canSeek: true, canPause: true } as const;
const STOPPED = { success: true, state: 'stopped', canSeek: false, canPause: false } as const;

/**
 * 起一台宿主替身与播放服务。宿主缺省在场，返回时播放服务已连上；`available: false` 时不等，
 * 由测试自己 `host.connect()` 再等 `playback.ready`。
 */
export async function startPlayingTrack(options: UnitHostOptions = {}): Promise<PlayingTrack> {
  const host = installFakeHost(options);
  const store = createStore();
  const playback = startPlayback(store, host.fb);
  if (options.available !== false) {
    await playback.ready;
    await flush();
  }
  return {
    host,
    store,
    playback,
    play: (track) => {
      host.answer('playback.getState', PLAYING);
      host.emit('playback:trackChanged', track);
    },
    edit: (track) => host.emit('playback:edited', track),
    stop: () => {
      // 真停了的宿主之后问状态也答停着；播放服务收到停止会回头核对，不是换曲途中才清曲目。
      host.answer('playback.getState', STOPPED);
      host.emit('playback:stopped', { reason: 'user' });
    },
    seek: (position) => host.emit('playback:seeked', { hostTime: Date.now(), position }),
  };
}
