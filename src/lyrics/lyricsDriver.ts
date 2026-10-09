import type { PlaybackClock } from 'foo-webview-sdk/bridge';

/** 驱动要用到的播放器方法，签名照 AMLL 的 `DomLyricPlayer`；时间单位是毫秒。 */
export interface LyricsPlayerFace {
  setCurrentTime(time: number, isSeek?: boolean): void;
  update(delta?: number): void;
  pause(): void;
  resume(): void;
}

export type LyricsClockFace = Pick<PlaybackClock, 'position' | 'state' | 'onChange'>;

/** 逐帧回调的来源；回调收到的时刻与 `performance.now()` 同一刻度。 */
export interface FrameSource {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const browserFrames: FrameSource = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface LyricsDriver {
  /** 歌词区看不见时停帧并暂停播放器；再看得见时直接跳到当前位置，不从停下的地方滚过去。 */
  setActive(active: boolean): void;
  setOffset(seconds: number): void;
  dispose(): void;
}

/**
 * 把 AMLL 播放器接到 SDK 的播放时钟上。AMLL 要求每帧推一次时间再 `update`；位置取时钟在这一帧时刻的
 * 估计，宿主约 100 ms 一次的进度事件之间也连续。跳转、换曲与时钟重新对准当作跳转告诉播放器，
 * 它据此直接排版、不播滚动；暂停与停止让播放器停住逐字动画。
 */
export function startLyricsDriver(
  player: LyricsPlayerFace,
  clock: LyricsClockFace,
  frames: FrameSource = browserFrames,
): LyricsDriver {
  let active = false;
  let disposed = false;
  let handle: number | null = null;
  let last = 0;
  let offset = 0;

  const ms = (seconds: number) => (seconds - offset) * 1000;

  function applyState(): void {
    if (clock.state === 'playing') player.resume();
    else player.pause();
  }

  function frame(now: number): void {
    handle = null;
    if (!active || disposed) return;
    player.setCurrentTime(ms(clock.position(now)));
    player.update(Math.max(0, now - last));
    last = now;
    handle = frames.request(frame);
  }

  function start(): void {
    player.setCurrentTime(ms(clock.position()), true);
    applyState();
    handle = frames.request((now) => {
      last = now;
      frame(now);
    });
  }

  function stop(): void {
    if (handle !== null) frames.cancel(handle);
    handle = null;
    player.pause();
  }

  const off = clock.onChange((change) => {
    if (!active || disposed) return;
    if (change.reason !== 'state') player.setCurrentTime(ms(change.position), true);
    applyState();
  });

  return {
    setActive(next) {
      if (disposed || next === active) return;
      active = next;
      if (active) start();
      else stop();
    },
    setOffset(seconds) {
      if (disposed || !Number.isFinite(seconds)) return;
      offset = seconds;
      if (active) player.setCurrentTime(ms(clock.position()), true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      stop();
      off();
    },
  };
}
