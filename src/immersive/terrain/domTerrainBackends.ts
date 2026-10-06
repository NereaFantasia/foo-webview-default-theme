import { openTerrainGpu } from './terrainGpu.ts';
import type { TerrainBackends } from './terrainMount.ts';
import { canvasDrawer, createTerrainPainter } from './terrainPainter.ts';
import { createWorkerTerrainPainter } from './terrainWorkerClient.ts';

/**
 * `terrainMount.ts` 在页面里的后端：canvas 建在 `container` 里、带上 `className`，铺满容器由样式定。
 * 每次换 canvas 都新建一块替掉旧的，React 严格模式下挂两次也各用各的，不会把转过控制权的 canvas 再转一次。
 */
export function domTerrainBackends(container: HTMLElement, className: string): TerrainBackends {
  let canvas: HTMLCanvasElement | null = null;
  // 当前 canvas 在主线程上开过 WebGL2：换下时主动交还上下文，不等回收。
  let glOpened = false;

  function releaseCanvas(): void {
    if (!canvas) return;
    if (glOpened) canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
    canvas = null;
    glOpened = false;
  }

  return {
    replaceCanvas() {
      releaseCanvas();
      canvas = document.createElement('canvas');
      canvas.className = className;
      container.append(canvas);
    },
    releaseCanvas,
    startWorker(history, settings, onError) {
      const element = canvas;
      if (
        !element ||
        typeof Worker === 'undefined' ||
        typeof element.transferControlToOffscreen !== 'function'
      ) {
        return null;
      }
      let worker: Worker;
      try {
        worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        return null;
      }
      let offscreen: OffscreenCanvas;
      try {
        offscreen = element.transferControlToOffscreen();
      } catch {
        worker.terminate();
        return null;
      }
      // `createWorkerTerrainPainter` 不管 Worker 的 error，由这里接住，交给调用方换一块 canvas 退回主线程。
      worker.addEventListener('error', onError);
      return createWorkerTerrainPainter(worker, offscreen, history, settings);
    },
    startMain(history, settings, gpu, onLost) {
      const element = canvas;
      if (!element) return null;
      // 建渲染器失败时 `openTerrainGpu` 抛错，这时 canvas 已经开了 WebGL2，先记下，换下时好交还。
      glOpened = gpu;
      const drawer = gpu ? openTerrainGpu(element, onLost) : null;
      glOpened = drawer !== null;
      // 退到 2D 时有意用 GPU 光栅（不给 `willReadFrequently`），与 Worker 那边相反：CPU 光栅放在主线程
      // 会把主线程跑满。
      const context = drawer ? null : element.getContext('2d');
      const chosen = drawer ?? (context ? canvasDrawer(element, context) : null);
      return chosen ? createTerrainPainter(chosen, history, settings) : null;
    },
  };
}
