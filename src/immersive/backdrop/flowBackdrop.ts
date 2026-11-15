import { loadFlowCover } from '../../theme/background/flowCover.ts';
import { advanceFlowMotion, createFlowMotion } from '../../theme/background/flowMotion.ts';
import { createFlowRenderer, type FlowRenderer } from '../../theme/background/flowRenderer.ts';
import type { FrameClock } from '../frame/frameScheduler.ts';
import type { BackdropRenderer } from './backdropRegistry.ts';

export interface FlowBackdropDeps {
  /** 创建底层渲染器，默认使用窗口背景的流动色场渲染器。创建上下文失败时抛出异常 */
  createRenderer?(canvas: HTMLCanvasElement): Pick<FlowRenderer, 'replace' | 'draw' | 'dispose'>;
  /** 提取封面像素数据，默认调用 `loadFlowCover` */
  load?(url: string, signal: AbortSignal): Promise<ImageData>;
  clock?: FrameClock;
}

const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** 封面切换过渡时长（毫秒）：间隔很近（连续点击下一首）时缩短，避免过渡总在中途被再次切换打断 */
const FADE_MS = 500;
const RAPID_FADE_MS = 300;
const RAPID_WINDOW_MS = 1500;

/** `requestAnimationFrame` 的时间戳本身有抖动，留 1 ms 余量，避免反而隔一帧才绘制（毫秒） */
const JITTER_MS = 1;

/** 三次平滑缓动曲线，与窗口背景流动色场封面渐变算法保持一致 */
const ease = (fade: number): number => (fade < 0.5 ? 4 * fade ** 3 : 1 - (-2 * fade + 2) ** 3 / 2);

function samePixels(a: ImageData, b: ImageData): boolean {
  return a.data.length === b.data.length && a.data.every((value, index) => value === b.data[index]);
}

/**
 * 沉浸视图「流动色场」背景：将窗口背景的封面驱动流动渲染器（封面平铺多层、扭曲、两遍重高斯模糊）适配至背景渲染器契约
 *
 * 仅以封面图像为输入源，不支持参数调节与音频律动，`setOptions`、`setLowFreqVolume`、`setHasLyric`、`setRenderScale` 均为空操作。
 * 内部渲染固定为 512×512，显示时按 `cover` 铺满。切换封面时新旧两张在渲染器内交叉渐变，无封面时 canvas 淡出至场景的中性底色。
 * 静态模式（减弱动效或性能守门介入）只绘制一帧即停止，运动与渐变直接呈现终态。流速倍率 1 为配方原速。
 * 帧率上限按帧间隔限制。窗口不可见时由外层适配器销毁整个渲染器，本模块不处理可见性
 */
export function createFlowBackdrop(deps: FlowBackdropDeps = {}): BackdropRenderer {
  const clock = deps.clock ?? browserClock;
  const load = deps.load ?? loadFlowCover;
  const canvas = document.createElement('canvas');
  const renderer = (deps.createRenderer ?? createFlowRenderer)(canvas);
  const motion = createFlowMotion();
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.objectFit = 'cover';
  canvas.style.opacity = '0';

  let disposed = false;
  let ready = false;
  let still = false;
  let fps = 60;
  let rate = 1;
  let frame = 0;
  let last = 0;
  let fade = 1;
  let duration = FADE_MS;
  let changedAt = -Infinity;
  let pixels: ImageData | null = null;
  let request: AbortController | null = null;

  const schedule = (): void => {
    if (!frame && !disposed && ready) frame = clock.request(paint);
  };
  /** 重置基准时间戳并调度重绘：从休眠唤醒、切换封面或切换静态模式时调用，避免将暂停时长计入形变位移 */
  const wake = (): void => {
    last = 0;
    schedule();
  };
  function fail(): void {
    ready = false;
    clock.cancel(frame);
    frame = 0;
    canvas.style.opacity = '0';
  }
  function paint(now: number): void {
    frame = 0;
    if (disposed || !ready) return;
    const period = 1000 / fps;
    if (last !== 0 && now - last < period - JITTER_MS) {
      schedule();
      return;
    }
    const elapsed = last === 0 ? 0 : Math.min(100, now - last);
    last = now;
    if (!still) advanceFlowMotion(motion, elapsed, rate);
    fade = still ? 1 : Math.min(1, fade + elapsed / duration);
    try {
      renderer.draw(motion, ease(fade), 'dark');
    } catch {
      fail();
      return;
    }
    if (!still) schedule();
  }
  const lost = (event: Event): void => {
    event.preventDefault();
    fail();
  };
  canvas.addEventListener('webglcontextlost', lost);

  return {
    getElement: () => canvas,
    async setAlbum(url) {
      request?.abort();
      request = null;
      if (!url) {
        // 无封面：canvas 淡出，显露场景底色
        pixels = null;
        ready = false;
        canvas.style.opacity = '0';
        return;
      }
      const controller = new AbortController();
      request = controller;
      let next: ImageData;
      try {
        next = await load(url, controller.signal);
      } catch {
        // 封面读取失败时保留上一张图像，没有上一张时保持中性底色
        if (request === controller) request = null;
        return;
      }
      if (disposed || controller.signal.aborted) return;
      request = null;
      if (ready && pixels && samePixels(pixels, next)) return;
      const now = performance.now();
      duration = now - changedAt < RAPID_WINDOW_MS ? RAPID_FADE_MS : FADE_MS;
      changedAt = now;
      const crossfade = ready && !still;
      try {
        renderer.replace(next, [], ease(fade));
      } catch {
        fail();
        return;
      }
      pixels = next;
      ready = true;
      fade = crossfade ? 0 : 1;
      canvas.style.opacity = '1';
      wake();
    },
    setRenderScale() {},
    setLowFreqVolume() {},
    setHasLyric() {},
    setOptions() {},
    setFPS(next) {
      fps = Number.isFinite(next) && next > 0 ? next : 60;
    },
    setFlowSpeed(speed) {
      rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
    },
    setStaticMode(enable) {
      if (still === enable) return;
      still = enable;
      wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clock.cancel(frame);
      frame = 0;
      request?.abort();
      canvas.removeEventListener('webglcontextlost', lost);
      renderer.dispose();
    },
  };
}
