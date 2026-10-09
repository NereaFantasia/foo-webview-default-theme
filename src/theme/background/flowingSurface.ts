import { DURATION_MS } from '../../motion/timing.ts';
import type { CoverProfile, CoverTone } from '../coverPalette.ts';
import type { ColorScheme } from '../themes.ts';
import { backgroundPalette, paintBackgroundPalette } from './backgroundPalette.ts';
import { advanceFlowMotion, setFlowPaused, type FlowMotion } from './flowMotion.ts';
import { createFlowRenderer, type FlowRenderer } from './flowRenderer.ts';

export interface FlowInput {
  readonly url: string;
  readonly base: CoverTone;
  readonly profile: CoverProfile | null;
  readonly running: boolean;
  readonly paused: boolean;
  readonly reduced: boolean;
  readonly focused: boolean;
  readonly scheme: ColorScheme;
}
export interface FlowSurface {
  update(input: FlowInput): void;
  suspend(scheme?: ColorScheme, clearCover?: boolean): void;
  dispose(): void;
}
export interface FlowMemory {
  readonly motion: FlowMotion;
  gpuFailed: boolean;
  cover: { readonly url: string; readonly pixels: ImageData } | null;
  preview: { readonly pixels: ImageData; readonly scheme: ColorScheme } | null;
}

/** 实例独占请求、绘制表面和 GPU；休眠只留当前封面像素与静态预览，迟到位图仍须关闭。 */
export function createFlowingSurface(
  parent: Pick<HTMLElement, 'append'>,
  memory: FlowMemory,
  onReady: () => void = () => {},
): FlowSurface {
  let canvas: HTMLCanvasElement | null = null;
  let preview: HTMLCanvasElement | null = null;
  let previewFade: Animation | null = null;
  let canvasFade: Animation | null = null;
  let canvasVisible = false;
  let announced = false;
  let loading = false;
  let renderer: FlowRenderer | null = null;
  let disposed = false;
  let active = false;
  let input: FlowInput | null = null;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let last = 0,
    deadline = -Infinity;
  let fade = 1,
    duration = 500,
    imageChangedAt = -Infinity;
  let imageReady = false;
  let imageKey: string | null = null;

  function clearPreview() {
    previewFade?.cancel();
    previewFade = null;
    if (preview) {
      preview.width = preview.height = 0;
      preview.remove();
      preview = null;
    }
  }
  function showPreview() {
    clearPreview();
    if (!memory.preview) return;
    preview = document.createElement('canvas');
    preview.dataset.flowPreview = '';
    preview.setAttribute('aria-hidden', 'true');
    preview.width = memory.preview.pixels.width;
    preview.height = memory.preview.pixels.height;
    preview
      .getContext('2d', { alpha: false, willReadFrequently: true })
      ?.putImageData(memory.preview.pixels, 0, 0);
    parent.append(preview);
  }
  function reveal() {
    if (canvas) canvas.style.opacity = imageReady ? '1' : '0';
    if (!imageReady) {
      canvasFade?.cancel();
      canvasFade = null;
    }
    if (canvas && !canvasVisible) {
      canvasVisible = true;
      canvas.style.visibility = 'visible';
      if (imageReady && announced && !preview && !input?.reduced)
        canvasFade = canvas.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: DURATION_MS.faster,
          easing: 'linear',
        });
    }
    if (input?.reduced) {
      canvasFade?.cancel();
      canvasFade = null;
      clearPreview();
    }
    if (!announced && !loading) {
      announced = true;
      onReady();
    }
    if (!preview || previewFade) return;
    const animation = preview.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: DURATION_MS.faster,
      easing: 'linear',
      fill: 'forwards',
    });
    previewFade = animation;
    void animation.finished.then(
      () => {
        if (previewFade === animation) clearPreview();
      },
      () => {},
    );
  }
  function staticFrame() {
    if (!input || !canvas) return;
    if (!input.url || !input.profile?.dominant) {
      neutral();
      return;
    }
    canvas.width = 64;
    canvas.height = 40;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    const pixels = context.createImageData(64, 40);
    paintBackgroundPalette(
      pixels.data,
      64,
      40,
      backgroundPalette(input.profile, input.base, input.scheme),
      0,
    );
    context.putImageData(pixels, 0, 0);
    imageReady = true;
    reveal();
  }
  function releaseCanvas() {
    canvasFade?.cancel();
    canvasFade = null;
    canvasVisible = false;
    canvas?.removeEventListener('webglcontextlost', lost);
    renderer?.dispose();
    renderer = null;
    if (canvas) {
      canvas.width = canvas.height = 0;
      canvas.remove();
      canvas = null;
    }
  }
  function appendCanvas() {
    const next = document.createElement('canvas');
    next.dataset.paletteField = '';
    next.setAttribute('aria-hidden', 'true');
    next.style.visibility = 'hidden';
    next.style.opacity = '0';
    parent.append(next);
    canvas = next;
    return next;
  }
  function fallback() {
    if (disposed) return;
    memory.gpuFailed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    request?.abort();
    loading = false;
    clearTimeout(timer);
    releaseCanvas();
    appendCanvas().dataset.flowBackend = 'static';
    staticFrame();
  }
  function lost(event: Event) {
    event.preventDefault();
    fallback();
  }
  function resume() {
    active = true;
    imageKey = null;
    imageReady = false;
    fade = 1;
    if (!memory.gpuFailed) {
      try {
        const next = appendCanvas();
        renderer = createFlowRenderer(next);
        next.dataset.flowBackend = 'webgl2';
        next.addEventListener('webglcontextlost', lost);
        if (memory.cover) {
          renderer.replace(memory.cover.pixels, [], 1);
          imageReady = true;
          imageKey = memory.cover.url;
        }
      } catch {
        fallback();
      }
    } else fallback();
  }
  showPreview();

  const progress = () =>
    input?.reduced ? 1 : fade < 0.5 ? 4 * fade ** 3 : 1 - (-2 * fade + 2) ** 3 / 2;
  function schedule() {
    if (!frame && !disposed && active && renderer) frame = requestAnimationFrame(paint);
  }
  function paint(now: number) {
    frame = 0;
    if (disposed || !active || !renderer || !input) return;
    const slowing = memory.motion.speed !== memory.motion.speedTarget;
    const period = 1000 / (input.paused && !slowing ? 15 : input.focused ? 60 : 30);
    if (now < deadline - 1) {
      schedule();
      return;
    }
    deadline = now - deadline > period ? now + period : deadline + period;
    const elapsed = last ? Math.min(100, now - last) : 0;
    last = now;
    const moving = input.running && !input.reduced && imageReady;
    if (moving) advanceFlowMotion(memory.motion, elapsed);
    fade = input.reduced ? 1 : Math.min(1, fade + elapsed / duration);
    try {
      if (imageReady) renderer.draw(memory.motion, progress(), input.scheme);
      reveal();
    } catch {
      fallback();
      return;
    }
    if (moving || fade < 1) schedule();
  }
  function wake() {
    last = 0;
    deadline = -Infinity;
    schedule();
  }
  function neutral() {
    if (!input) return;
    // 让最后画面淡出到窗口的中性底，避免将强调色放大成整窗背景。
    imageReady = false;
    memory.cover = null;
    memory.preview = null;
    clearPreview();
    fade = 1;
    reveal();
    wake();
  }
  async function load(url: string, controller: AbortController) {
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('背景封面读取失败');
      const bitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: 512,
        resizeHeight: 512,
        resizeQuality: 'high',
      });
      try {
        if (disposed || controller.signal.aborted || !renderer || !input) return;
        const sample = new OffscreenCanvas(512, 512);
        const context = sample.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('无法读取背景封面像素');
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, 512, 512);
        const current = memory.cover;
        // 地址包含曲目路径；逐像素比较封面本身，不能用暂时沿用的取色结果判断身份。
        if (
          imageReady &&
          current &&
          pixels.data.every((value, index) => value === current.pixels.data[index])
        ) {
          memory.cover = { url, pixels: current.pixels };
          return;
        }
        const now = performance.now();
        duration = now - imageChangedAt < 1500 ? 300 : 500;
        imageChangedAt = now;
        const transition = imageReady;
        renderer.replace(pixels, [], progress());
        memory.cover = { url, pixels };
        imageReady = true;
        fade = announced && transition && !input.reduced ? 0 : 1;
        wake();
      } finally {
        bitmap.close();
      }
    } catch {
      if (!disposed && !controller.signal.aborted) neutral();
    } finally {
      if (request === controller) {
        request = null;
        loading = false;
        clearTimeout(timer);
        wake();
      }
    }
  }
  function discardPreview(scheme: ColorScheme) {
    if (memory.preview && memory.preview.scheme !== scheme) {
      memory.preview = null;
      clearPreview();
    }
  }
  function suspend(scheme?: ColorScheme, clearCover = false) {
    if (disposed) return;
    if (clearCover) {
      imageReady = false;
      memory.cover = null;
      memory.preview = null;
      clearPreview();
    }
    if (!active) {
      if (scheme) discardPreview(scheme);
      return;
    }
    active = false;
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(timer);
    request?.abort();
    request = null;
    loading = false;
    try {
      const pixels = !imageReady
        ? null
        : renderer
          ? renderer.snapshot()
          : canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
      memory.preview = pixels && input ? { pixels, scheme: input.scheme } : null;
    } catch {
      // 上下文丢失时保留已有预览，资源仍须同步释放。
    }
    showPreview();
    if (scheme) discardPreview(scheme);
    releaseCanvas();
    input = null;
  }
  return {
    update(next) {
      if (disposed) return;
      const baseChanged = input?.base.argb !== next.base.argb;
      const schemeChanged = input?.scheme !== next.scheme;
      discardPreview(next.scheme);
      if (!active) resume();
      setFlowPaused(
        memory.motion,
        next.paused,
        !input || !imageReady || !next.running || next.reduced,
      );
      input = next;
      if (!renderer) {
        staticFrame();
        return;
      }
      if (imageKey !== next.url) {
        imageKey = next.url;
        request?.abort();
        clearTimeout(timer);
        loading = Boolean(next.url && (!imageReady || memory.cover?.url !== next.url));
        if (!imageReady) neutral();
        if (next.url && (!imageReady || memory.cover?.url !== next.url)) {
          const controller = new AbortController();
          request = controller;
          timer = setTimeout(() => {
            controller.abort();
            loading = false;
            if (!disposed) neutral();
          }, 10_000);
          void load(next.url, controller);
        } else if (!next.url && imageReady) timer = setTimeout(neutral, DURATION_MS.normal);
      } else if (!imageReady && baseChanged) neutral();
      if (next.reduced) {
        fade = 1;
        canvasFade?.cancel();
        canvasFade = null;
        clearPreview();
      }
      if (schemeChanged) {
        // 与主题文字在同一轮更新呈色，避免等下一帧时露出另一主题的背景。
        try {
          if (imageReady) renderer.draw(memory.motion, progress(), next.scheme);
          reveal();
        } catch {
          fallback();
          return;
        }
      }
      wake();
    },
    suspend,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      request?.abort();
      releaseCanvas();
      clearPreview();
      input = null;
    },
  };
}
