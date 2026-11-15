import type { ReactNode } from 'react';
import styles from './SettingsSubheading.module.css';

/** 分区里一组卡的小节名，比分区的大标题低一级；一个分区里分了组就每组都写 */
export function SettingsSubheading({ children }: { readonly children: ReactNode }) {
  return <h3 className={styles.subheading}>{children}</h3>;
}
