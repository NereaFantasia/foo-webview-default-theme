import { setPaintFpsCap } from '../frame/frameScheduler.ts';
import { createSpectrumHistory, type SpectrumHistory } from './terrain.ts';
import { openTerrainGpu } from './terrainGpu.ts';
import {
  canvasDrawer,
  createTerrainPainter,
  type TerrainDrawer,
  type TerrainPainter,
} from './terrainPainter.ts';
import {
  isTerrainWorkerMessage,
  mirrorRows,
  type TerrainWorkerReply,
} from './terrainWorkerClient.ts';

/**
 * 山脊图的 Worker：接主线程转过来的 `OffscreenCanvas`，重画循环在这里跑，`requestAnimationFrame` 跟
 * canvas 所在页面的刷新走。消息约定见 `terrainWorkerClient.ts`。这里抛出的异常会在主线程的 Worker 上
 * 触发 error；`createWorkerTerrainPainter` 不处理它，挂 Worker 的一方要自己监听 error，换一块新 canvas
 * 在主线程画（转出去的 canvas 收不回来）。主线程那条退到 2D 时不给 `willReadFrequently`、用 GPU 光栅，
 * 与这里相反：CPU 光栅放在主线程会把主线程跑满。
 */
let history: SpectrumHistory = createSpectrumHistory(1, 2);
let painter: TerrainPainter | null = null;

/**
 * 优先整幅交给 GPU 画（`terrainGpu.ts`），Worker 每帧只发绘制命令。用不了就退回 CPU 光栅的 2D canvas：
 * GPU 光栅时这块 canvas 每帧上万条线段都落在 GPU 进程主线程上，把它压满，整页跟着掉帧；
 * CPU 光栅把这份活留在 Worker 线程里。
 * WebGL 上下文丢了，下一次 `draw` 时抛错，按上面 Worker 出错的路子退回主线程。
 */
function openDrawer(canvas: OffscreenCanvas): TerrainDrawer {
  const gpu = openTerrainGpu(canvas, () => {
    throw new Error('山脊图的 WebGL 上下文丢了');
  });
  if (gpu) return gpu;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('山脊图离屏画布拿不到 2D 上下文');
  return canvasDrawer(canvas, context);
}

addEventListener('message', (event) => {
  const message: unknown = event.data;
  if (!isTerrainWorkerMessage(message)) return;
  switch (message.type) {
    case 'init': {
      painter = createTerrainPainter(openDrawer(message.canvas), () => history, message.settings);
      break;
    }
    case 'rows':
      history = mirrorRows(history, message);
      if (message.arrived) painter?.frameArrived();
      else painter?.update({});
      break;
    case 'update':
      painter?.update(message.settings);
      break;
    case 'paintCap':
      setPaintFpsCap(message.fps);
      break;
    case 'meter':
      painter?.meter(
        message.on
          ? (stats, surface) =>
              postMessage({ type: 'paintStats', stats, surface } satisfies TerrainWorkerReply)
          : null,
      );
      break;
  }
});
