import type { FrameClock } from '../../src/immersive/frame/frameScheduler.ts';

/** 60 Hz 屏上一拍的毫秒数。 */
export const FRAME_MS = 1000 / 60;

/** 等在途的宿主应答都落地：连走几轮宏任务，期间排出的微任务一并跑完。 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export interface FakeFrames {
  readonly clock: FrameClock;
  /** 帧时钟此刻的时间（毫秒），与回调收到的时间戳同一时基。 */
  now(): number;
  /** 排着的回调数。 */
  pending(): number;
  /** 时间推进 `ms`，跑这一拍之前排着的回调，再等应答落地。 */
  step(ms?: number): Promise<void>;
  /** 按 `FRAME_MS` 一拍拍走，走满 `ms` 之前的每一拍（不含到点那一拍）。 */
  stepWithin(ms: number): Promise<void>;
}

/** 手动走的帧时钟。 */
export function fakeFrames(): FakeFrames {
  let time = 0;
  let nextHandle = 1;
  const pending = new Map<number, (now: number) => void>();
  const frames: FakeFrames = {
    clock: {
      request(callback) {
        const handle = nextHandle;
        nextHandle += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancel(handle) {
        pending.delete(handle);
      },
    },
    now: () => time,
    pending: () => pending.size,
    async step(ms = FRAME_MS) {
      time += ms;
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback(time);
      await flush();
    },
    async stepWithin(ms) {
      for (let elapsed = FRAME_MS; elapsed < ms - 1; elapsed += FRAME_MS) await frames.step();
    },
  };
  return frames;
}
