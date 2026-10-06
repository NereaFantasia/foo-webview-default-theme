import { Portal } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import styles from './ColumnGhost.module.css';
import { columnDef, type ColumnId } from './columns.ts';

/** 跟着指针走的列名；`leaving` 为真时在淡出。 */
export interface ColumnGhostState {
  readonly id: ColumnId;
  readonly x: number;
  readonly y: number;
  readonly leaving: boolean;
}

export interface ColumnGhostProps {
  readonly ghost: ColumnGhostState | null;
}

/** 拖动换列时跟着指针走的列名。挂在 body 下，不被表格的裁剪挡住。 */
export function ColumnGhost({ ghost }: ColumnGhostProps) {
  const t = useAtomValueRawSync(translateAtom);
  if (!ghost) return null;
  return (
    <Portal>
      <span
        className={styles.ghost}
        data-leaving={ghost.leaving || undefined}
        style={{ left: ghost.x, top: ghost.y }}
        aria-hidden
      >
        {t(columnDef(ghost.id).label)}
      </span>
    </Portal>
  );
}
