import { useEffect, useLayoutEffect, useRef } from 'react';
import { controlOffsets, coverUv, sampleCover, shade, warp } from './coverWarp.ts';
import { GRAIN_SIZE, grainPixels } from './ditherGrain.ts';
import styles from './PaperCoverStatic.module.css';

export interface PaperCoverStaticProps {
  /** 预糊过的源图，`SOURCE_SIZE` 见方（`coverSource.ts`）。 */
  readonly cover: ImageData;
  /** 纸面色，线性光 0–1。 */
  readonly paper: readonly [number, number, number];
  /** 封面混进纸面的比例，0–1。 */
  readonly strength: number;
  /** 按 canvas 实际尺寸算完第一帧后调一次。 */
  readonly onReady: () => void;
  readonly className?: string;
}

type FieldInput = Pick<PaperCoverStaticProps, 'cover' | 'paper' | 'strength'>;

/** 色场按 CSS 尺寸的 1/`DOWNSCALE` 算，浏览器放大铺满。 */
const DOWNSCALE = 8;
/**
 * 色场长边的上限（位图像素）：源图只有 128 见方、又预糊过，再细也看不出差别，逐像素的计算却随面积涨。
 * 1920 × 1080 的窗口正好到这里；更大的窗口按同样的宽高比缩到它以内。
 */
const MAX_FIELD_SIDE = 240;

/** 容器 CSS 尺寸下色场位图的宽高：先按 `DOWNSCALE` 缩，长边再封顶到 `MAX_FIELD_SIDE`。 */
function fieldSize(width: number, height: number): { width: number; height: number } {
  const scaled = { width: width / DOWNSCALE, height: height / DOWNSCALE };
  const fit = Math.min(1, MAX_FIELD_SIDE / Math.max(scaled.width, scaled.height, 1));
  return {
    width: Math.max(1, Math.ceil(scaled.width * fit)),
    height: Math.max(1, Math.ceil(scaled.height * fit)),
  };
}

/** 第 0 秒的变形：逐像素反查封面、混进纸面色，写成不透明的位图，尺寸取 canvas 当前的宽高。 */
function renderField(canvas: HTMLCanvasElement, { cover, paper, strength }: FieldInput): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  const offsets = controlOffsets(0);
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [u, v] = coverUv(x + 0.5, y + 0.5, width, height);
      const [wu, wv] = warp(u, v, offsets, 0);
      const color = shade(sampleCover(cover.data, cover.width, wu, wv), paper, strength);
      const at = (y * width + x) * 4;
      image.data[at] = Math.round(color[0] * 255);
      image.data[at + 1] = Math.round(color[1] * 255);
      image.data[at + 2] = Math.round(color[2] * 255);
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

let grainUrl: string | null = null;

/** 颗粒贴图的 `url()`：种子固定、每次生成同一张，整页只生成一次。 */
function grainImage(): string {
  if (grainUrl === null) {
    const tile = document.createElement('canvas');
    tile.width = GRAIN_SIZE;
    tile.height = GRAIN_SIZE;
    tile.getContext('2d')?.putImageData(new ImageData(grainPixels(), GRAIN_SIZE), 0, 0);
    grainUrl = `url(${tile.toDataURL()})`;
  }
  return grainUrl;
}

/**
 * 封面底色的静态档：流动档不可用、开了减弱动效或偏好选了静态档时用。画面停在第 0 秒的变形，由 JS 在一块
 * 1/`DOWNSCALE` 大小（长边不超过 `MAX_FIELD_SIDE`）的 2D canvas 上逐像素算一次、浏览器放大铺满，
 * 只在封面、纸面色、比例或位图尺寸变了时重算。
 *
 * 放大后的渐变经 8 bit 量化会出断层，上面铺一层静态抖动颗粒（`ditherGrain.ts`）打散：画面不动时静态颗粒就够，
 * 流动档才需要逐帧换种子的抖动。按 canvas 实际尺寸算完第一帧后调一次 `onReady`，上层等到这时才让它显出来。
 */
export function PaperCoverStatic({
  cover,
  paper,
  strength,
  onReady,
  className,
}: PaperCoverStaticProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sized = useRef(false);
  const latest = useRef({ cover, paper, strength, onReady });
  useLayoutEffect(() => {
    latest.current = { cover, paper, strength, onReady };
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let announced = false;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const size = fieldSize(box.width, box.height);
      // 尺寸落到同一张位图上就不重算：拖窗口边时多数回调只差几个 CSS 像素。
      if (sized.current && size.width === element.width && size.height === element.height) return;
      element.width = size.width;
      element.height = size.height;
      sized.current = true;
      renderField(element, latest.current);
      if (!announced) {
        announced = true;
        latest.current.onReady();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 量到尺寸之前不算：canvas 还是缺省的 300 × 150，算了也会被第一次量尺寸盖掉。
  useEffect(() => {
    const element = canvas.current;
    if (element && sized.current) renderField(element, { cover, paper, strength });
  }, [cover, paper, strength]);

  // 颗粒按设备像素 1:1 铺：按 CSS 像素铺会被插值放大，颗粒变软、打散断层的效果变弱。
  const grain = {
    backgroundImage: grainImage(),
    backgroundSize: `${GRAIN_SIZE / (window.devicePixelRatio || 1)}px`,
  };
  return (
    <div className={className ? `${styles.static} ${className}` : styles.static} aria-hidden>
      <canvas ref={canvas} className={styles.field} />
      <div className={styles.grain} style={grain} />
    </div>
  );
}
