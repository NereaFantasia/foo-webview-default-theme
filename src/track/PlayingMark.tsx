import styles from './PlayingMark.module.css';

export interface PlayingMarkProps {
  /** 正在出声时几根竖条跳动；暂停时静止。系统要求减弱动效时一律静止。 */
  readonly active?: boolean;
  /** 读屏念的文字；不给时记号只是装饰，读屏跳过。 */
  readonly label?: string;
  readonly className?: string;
}

/**
 * 正在播放的记号：几根高低不一的竖条，取品牌色。表格的序号格与侧边栏的列表项用它标出正在播放的
 * 那一项。边长跟着字号走（1em 见方），放进哪里就随那里的字号缩放。
 */
export function PlayingMark({ active = false, label, className }: PlayingMarkProps) {
  return (
    <span
      className={className ? `${styles.mark} ${className}` : styles.mark}
      data-active={active || undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className={styles.bar} />
      <span className={styles.bar} />
      <span className={styles.bar} />
      <span className={styles.bar} />
    </span>
  );
}
