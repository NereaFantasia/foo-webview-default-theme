import { useEffect, useLayoutEffect, useRef } from 'react';
import { controlOffsets, rotationAt, SATURATION } from './coverWarp.ts';
import { createWarpRenderer } from './warpShader.ts';
import { createFrameGovernor } from '../frame/frameGovernor.ts';
import { createFrameScheduler } from '../frame/frameScheduler.ts';
import { canvasRatio } from '../paper/stageScale.ts';
import styles from './PaperCoverFlow.module.css';

export interface PaperCoverFlowProps {
  /** 预糊过的源图，`SOURCE_SIZE` 见方（`coverSource.ts`）；换了就换一块 canvas 重建。 */
  readonly cover: ImageData;
  /** 纸面色，线性光 0–1。 */
  readonly paper: readonly [number, number, number];
  /** 封面混进纸面的比例，0–1。 */
  readonly strength: number;
  /** 播放中才流动；暂停停在当前画面、不再排帧。 */
  readonly playing: boolean;
  /** 按 canvas 实际尺寸画出第一帧后调一次。 */
  readonly onReady: () => void;
  /** 建不出上下文、上下文丢失或帧率守门跳闸时调一次，之后不再画。 */
  readonly onFallback: () => void;
  readonly className?: string;
}

/** 两次重画之间最多记这么多毫秒的流动：页面隐藏、窗口拖动回来后不一下跳一大截。 */
const MAX_STEP_MS = 100;

/**
 * 封面底色的流动档：一块 WebGL canvas 画 `warpShader.ts` 的网格变形封面。一个实例只画一张封面：换曲时上层按层的
 * key 换实例，新旧两块在淡入淡出期间各画各的。
 *
 * canvas 按设备像素 1:1 渲染：着色器里的抖动要逐像素才打得散断层，低分辨率放大会把它抹成团块。这一层铺在舞台外，
 * 不乘舞台缩放。只在播放时推进时间、经 `frameScheduler.ts` 重画；暂停停在当前画面且不再排帧。走过的时间只在
 * 真在画的帧之间累加，一次最多记 `MAX_STEP_MS`。改尺寸会清掉画面，当场补画一帧，不等下一次重画。
 *
 * 建不出上下文、上下文丢失、帧率守门（`frameGovernor.ts`）判定扛不住，三种情况都调 `onFallback`，由上层换成静态档。
 * 按 canvas 实际尺寸画出第一帧后调一次 `onReady`：上层等到这时才让它显出来，着色器编译、纹理上传与首帧之前不露面。
 *
 * canvas 在 effect 里现建，清理时让上下文立即失效再丢掉：页面同时开着的 WebGL 上下文有上限，超了浏览器让最早建的
 * 那个失效，可能是别的件的；失效的上下文在同一块 canvas 上要不回来，所以每次都换一块新的。
 */
export function PaperCoverFlow({
  cover,
  paper,
  strength,
  playing,
  onReady,
  onFallback,
  className,
}: PaperCoverFlowProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ paper, strength, playing, onReady, onFallback });
  useLayoutEffect(() => {
    latest.current = { paper, strength, playing, onReady, onFallback };
  });
  /** 排一次重画；只在 canvas 与上下文活着时有效。 */
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas;
    box.append(canvas);
    const renderer = createWarpRenderer(canvas, cover);
    if (!renderer) {
      latest.current.onFallback();
      // 着色器编译、链接失败时上下文已经建了：同样当场交还，不占名额等回收。
      return () => {
        canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.remove();
      };
    }
    const governor = createFrameGovernor();
    let failed = false;
    let sized = false;
    let announced = false;
    let seconds = 0;
    let lastNow: number | undefined;
    let frameCount = 0;

    function fail(): void {
      if (failed) return;
      failed = true;
      frames.cancel();
      latest.current.onFallback();
    }

    function draw(): void {
      if (failed || !sized || !renderer) return;
      if (renderer.lost()) return fail();
      frameCount = (frameCount + 1) % 256;
      renderer.draw({
        width: canvas.width,
        height: canvas.height,
        offsets: controlOffsets(seconds),
        angle: rotationAt(seconds),
        paper: latest.current.paper,
        strength: latest.current.strength,
        saturation: SATURATION,
        seed: frameCount + 0.5,
      });
      if (!announced) {
        announced = true;
        latest.current.onReady();
      }
    }

    function tick(now: number): void {
      if (failed) return;
      const moving = latest.current.playing;
      if (moving && lastNow !== undefined) {
        const step = now - lastNow;
        seconds += Math.min(step, MAX_STEP_MS) / 1000;
        if (governor.record(step)) return fail();
      }
      lastNow = moving ? now : undefined;
      draw();
      if (moving && !failed) frames.schedule();
    }

    const frames = createFrameScheduler(tick);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || failed) return;
      const ratio = canvasRatio(1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      sized = true;
      draw();
      if (latest.current.playing) frames.schedule();
    });
    canvas.addEventListener('webglcontextlost', fail);
    observer.observe(box);
    wake.current = () => {
      if (!failed) frames.schedule();
    };

    return () => {
      failed = true;
      wake.current = () => {};
      observer.disconnect();
      frames.cancel();
      canvas.removeEventListener('webglcontextlost', fail);
      renderer.dispose();
      canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, [cover]);

  useEffect(() => {
    wake.current();
  }, [paper, strength, playing]);

  return (
    <div
      ref={host}
      className={className ? `${styles.flow} ${className}` : styles.flow}
      aria-hidden
    />
  );
}
