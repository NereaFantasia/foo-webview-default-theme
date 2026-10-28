import { SidebarIcon } from '../../nav/sidebar/SidebarIcon.tsx';
import type { SidebarItemId } from '../../nav/sidebar/sidebarNav.ts';
import styles from './StartPlaceThumb.module.css';

/** 启动默认地点缩略图，居中展示对应侧边栏导航图标并自适应缩放 */
export function StartPlaceThumb({ place }: { readonly place: SidebarItemId }) {
  return (
    <span className={styles.root} data-place={place}>
      <span className={styles.icon}>
        <SidebarIcon id={place} />
      </span>
    </span>
  );
}
