import type { CSSProperties, ReactNode } from 'react';
import styles from './FloatingBar.module.css';

/** 工具条各块的高度（像素）；列底要留出它加上下各一档间距的位置，免得滚到头时最后一行被盖住 */
export const FLOATING_BAR_HEIGHT = 44;

/** 一块在条里的位置：决定哪几个角是半圆、阴影往哪边的缝里投；单独一块是 `only` */
export type FloatingPiecePosition = 'first' | 'middle' | 'last' | 'only';

interface FloatingBarProps {
  /** 工具条的可访问名称 */
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * 悬浮在列底的工具条（队列页、历史页共用）：几块各有自己的毛玻璃底拼在一起，拼法与毛玻璃见样式
 * 毛玻璃用到的变量（`--float-*`、`--column-shadow`）由列外壳写下（`scene/CardColumn.tsx`）
 */
export function FloatingBar({ label, children }: FloatingBarProps) {
  const size: CSSProperties & Record<`--${string}`, string> = {
    '--bar-height': `${FLOATING_BAR_HEIGHT}px`,
  };
  return (
    <div className={styles.bar} role="toolbar" aria-label={label} style={size}>
      {children}
    </div>
  );
}

export function FloatingPiece({
  position,
  children,
}: {
  readonly position: FloatingPiecePosition;
  readonly children: ReactNode;
}) {
  return (
    <div role="group" className={styles.piece} data-pos={position}>
      {children}
    </div>
  );
}
