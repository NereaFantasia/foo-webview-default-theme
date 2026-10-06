import { useEffect, useRef } from 'react';
import { DURATION_MS } from '../../motion/timing.ts';
import { paintBackgroundPalette, type PaletteCorners } from './backgroundPalette.ts';
import styles from './PaletteField.module.css';

export interface PaletteFieldProps {
  readonly colors: PaletteCorners;
  readonly running: boolean;
  readonly reduced: boolean;
}

export function PaletteField({ colors, running, reduced }: PaletteFieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  const shown = useRef(colors);
  useEffect(() => {
    const context = canvas.current?.getContext('2d', { alpha: false });
    if (!context) return;
    const image = context.createImageData(64, 40);
    const previous = shown.current;
    let started = performance.now();
    let last = started;
    let frame = 0;
    let moving = running && !reduced;
    const paint = (now: number) => {
      if (document.hidden) return;
      const mix = reduced ? 1 : Math.min(1, (now - started) / DURATION_MS.faster);
      const next = colors.map(
        (value, index) => (previous[index] ?? value) * (1 - mix) + value * mix,
      );
      shown.current = next;
      if (moving) phase.current += Math.min(100, now - last) * 0.00012;
      last = now;
      paintBackgroundPalette(image.data, image.width, image.height, next, phase.current);
      context.putImageData(image, 0, 0);
      if (moving || mix < 1) frame = requestAnimationFrame(paint);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        last = performance.now();
        started = last - DURATION_MS.faster;
        paint(last);
      }
    };
    paint(started);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      moving = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [colors, running, reduced]);
  return (
    <canvas
      ref={canvas}
      width={64}
      height={40}
      className={styles.root}
      data-palette-field
      aria-hidden="true"
    />
  );
}
