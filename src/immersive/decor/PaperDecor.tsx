import { useAtomValueRawSync } from 'jotai/react';
import { atom } from 'jotai/vanilla';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { coverRampAtom as accentRampAtom } from '../../theme/accentState.ts';
import { canvasRatio } from '../paper/stageScale.ts';
import { buildDecor, seedFromKey, type Decor, type DecorArc, type Rect } from './paperDecor.ts';
import { drawDecor, type DecorStyle } from './paperDecorDraw.ts';
import styles from './PaperDecor.module.css';

export interface PaperDecorProps {
  /** 不放装饰的区域，内容层坐标（`useDecorGuards` 量的）。 */
  readonly guards: readonly Rect[];
  /** 内容层左上角在场景里的位置：格线对齐它。 */
  readonly origin: { readonly x: number; readonly y: number };
  /** 内容层尺寸，内容层坐标：径向微光围着它的中心。 */
  readonly sheet: { readonly width: number; readonly height: number };
  /** 三段仪表弧，内容层坐标。 */
  readonly arcs: readonly DecorArc[];
  /** 内容层坐标到场景像素的比，full 档是舞台缩放。 */
  readonly scale: number;
  /** 网页版一个像素在场景里多长，记号尺寸与密度按它算；不给按版心换算。 */
  readonly unit?: number;
}

interface DecorInput extends Omit<PaperDecorProps, 'unit'> {
  readonly unit: number | undefined;
  readonly seed: number;
}

// 编辑标签也会换曲目对象，派生成种子，只有换曲才叫醒这一层。
const decorSeedAtom = atom((get) => seedFromKey(trackKeyOf(get(currentTrackAtom))));

/** 布局、颜色与 2D 上下文都留在这里，重画时不经 React 状态。 */
function createDecorPainter() {
  let ctx: CanvasRenderingContext2D | null = null;
  let width = 0;
  let height = 0;
  let decor: Decor | null = null;
  let style: DecorStyle | null = null;

  /** 解析不了的值 `fillStyle` 会忽略、留着上一次的，所以先复位成透明：坏 token 画不出东西，不会串成别的色。 */
  function normalized(value: string): string {
    if (!ctx) return value;
    ctx.fillStyle = 'transparent';
    ctx.fillStyle = value;
    return String(ctx.fillStyle);
  }

  function paint(): void {
    if (ctx && decor && style) drawDecor(ctx, decor, style);
  }

  return {
    paint,
    /** 按 CSS 尺寸开物理像素；这一层铺在舞台外，不乘舞台缩放。改 canvas 尺寸会清空位图。 */
    resize(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
      const ratio = canvasRatio(1);
      width = cssWidth;
      height = cssHeight;
      canvas.width = Math.max(1, Math.round(cssWidth * ratio));
      canvas.height = Math.max(1, Math.round(cssHeight * ratio));
      ctx = canvas.getContext('2d');
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
    layout(input: DecorInput): void {
      decor = width > 0 && height > 0 ? buildDecor({ ...input, width, height }) : null;
    },
    /** 按变量名现读颜色再画一次；canvas 读不到 CSS 变量，只能取计算样式。 */
    recolor(canvas: HTMLCanvasElement): void {
      const computed = getComputedStyle(canvas);
      const token = (name: string): string => normalized(computed.getPropertyValue(name).trim());
      style = {
        grid: token('--paper-grid'),
        ink: token('--paper-ink'),
        hot: token('--paper-hot'),
        neutral: token('--colorNeutralForeground1'),
        mono: computed.getPropertyValue('--fontFamilyMonospace').trim() || 'monospace',
      };
      paint();
    },
  };
}

/**
 * 图纸的生成式网格层：铺满场景的一块静态 canvas，压在山脊图之上、内容层之下。布局（`buildDecor`）在尺寸、种子、
 * 护区或内容层几何变了时重建；颜色在挂载、封面 ramp 变、深浅变、尺寸变四个时机按变量名现读一次，然后重画一次，
 * 不进帧循环。
 *
 * 种子取曲目键：同一首每次进来是同一张图，换曲换一张。读到的颜色经 2D 上下文的 `fillStyle` 规整：不透明色成六位
 * 十六进制，作画时要给渐变配同色的透明端，得先认得出颜色。主题的样式规则在同一次提交里先于各 effect 写进文档，
 * ramp 或深浅一变，effect 里现读就是新值。
 */
export function PaperDecor({ guards, origin, sheet, arcs, scale, unit }: PaperDecorProps) {
  const seed = useAtomValueRawSync(decorSeedAtom);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [painter] = useState(createDecorPainter);
  const input: DecorInput = { guards, origin, sheet, arcs, scale, unit, seed };
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      // 改尺寸清掉了位图，颜色也可能随断点变：重排、重读颜色再画。
      painter.resize(element, box.width, box.height);
      painter.layout(latest.current);
      painter.recolor(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [painter]);

  useEffect(() => {
    painter.layout({ guards, origin, sheet, arcs, scale, unit, seed });
    painter.paint();
  }, [painter, guards, origin, sheet, arcs, scale, unit, seed]);

  useEffect(() => {
    const element = canvas.current;
    if (element) painter.recolor(element);
  }, [painter, ramp, scheme]);

  return <canvas ref={canvas} className={styles.decor} aria-hidden />;
}
