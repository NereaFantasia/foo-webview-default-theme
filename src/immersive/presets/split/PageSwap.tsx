import { useState, type ReactNode } from 'react';
import styles from './PageSwap.module.css';

/**
 * 侧栏页面切换动效容器
 *
 * 页面标识变化时触发位移与淡入组合动画，初次挂载静默呈现；减弱动效模式下压缩至瞬时切换
 */
export function PageSwap({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  const [state, setState] = useState({ id, swapped: false });
  if (state.id !== id) setState({ id, swapped: true });
  return (
    <div key={id} className={state.swapped ? styles.swap : styles.page}>
      {children}
    </div>
  );
}
