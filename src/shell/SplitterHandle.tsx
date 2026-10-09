import type { ComponentProps } from 'react';
import styles from './SplitterHandle.module.css';

interface SplitterHandleProps extends Pick<
  ComponentProps<'div'>,
  | 'ref'
  | 'className'
  | 'aria-label'
  | 'aria-valuenow'
  | 'aria-valuemin'
  | 'aria-valuemax'
  | 'onPointerDown'
  | 'onDoubleClick'
> {
  readonly dragging: boolean;
}

/** 外壳分栏手柄共用焦点、拖动反馈与外观，定位由所属栏位决定。 */
export function SplitterHandle({ className, dragging, ...props }: SplitterHandleProps) {
  return (
    <div
      {...props}
      className={`${styles.handle} ${className ?? ''}`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      data-dragging={dragging || undefined}
    >
      <span className={styles.grip} aria-hidden="true" />
    </div>
  );
}
