import { vi } from 'vitest';
import { profileFromPixels, type CoverProfile } from '../../src/theme/coverPalette.ts';

/** 只替代 Worker 传输，像素分析仍走实际算法。 */
export function stubColorWorker(): void {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: CoverProfile }) => void) | null = null;
      terminate() {}
      postMessage(pixels: Uint8ClampedArray) {
        queueMicrotask(() => this.onmessage?.({ data: profileFromPixels(pixels) }));
      }
    },
  );
}
