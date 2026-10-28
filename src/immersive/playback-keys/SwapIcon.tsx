import { useState, type ReactNode } from 'react';
import styles from './SwapIcon.module.css';

/**
 * 图标切换动效外壳
 *
 * 在图标标识发生变化时触发 83 ms 线性淡入动画；初次挂载不触发，系统减弱动效时自动缩短至瞬时切换
 */
export function SwapIcon({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const [state, setState] = useState({ id, swapped: false });
  if (state.id !== id) setState({ id, swapped: true });
  return (
    <span key={id} className={state.swapped ? styles.swap : styles.still}>
      {children}
    </span>
  );
}
