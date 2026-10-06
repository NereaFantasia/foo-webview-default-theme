import styles from './MenuCaption.module.css';

export interface MenuCaptionProps {
  readonly title: string;
  /** 第二行的补充，如艺术家、共几首；不给就只有一行。 */
  readonly meta?: string;
}

/** 菜单顶上的说明行，放在 `MenuList` 的第一项、分隔线之前；不是菜单项，键盘也走不到它。 */
export function MenuCaption({ title, meta }: MenuCaptionProps) {
  return (
    <div className={styles.caption} role="presentation" data-menu-caption>
      <span className={styles.title} title={title}>
        {title}
      </span>
      {meta && <span className={styles.meta}>{meta}</span>}
    </div>
  );
}
