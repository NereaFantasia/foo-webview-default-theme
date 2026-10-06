import type { useLibrarySplit } from './useLibrarySplit.ts';
import styles from './LibrarySplitHandle.module.css';

interface LibrarySplitHandleProps {
  readonly split: ReturnType<typeof useLibrarySplit>;
  readonly label: string;
}

export function LibrarySplitHandle({ split, label }: LibrarySplitHandleProps) {
  return (
    <div
      ref={split.separator}
      className={styles.root}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(split.size)}
      aria-valuemin={split.minimum}
      aria-valuemax={split.maximum}
      onPointerDown={split.onPointerDown}
      onPointerMove={split.onPointerMove}
      onPointerUp={split.onPointerUp}
      onPointerCancel={split.onPointerCancel}
      onLostPointerCapture={split.onPointerCancel}
    />
  );
}
