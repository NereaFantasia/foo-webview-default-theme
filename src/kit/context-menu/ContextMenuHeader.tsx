import styles from './ContextMenuHeader.module.css';

export interface ContextMenuHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly compact: boolean;
}

export function ContextMenuHeader({ title, subtitle, compact }: ContextMenuHeaderProps) {
  return (
    <div className={styles.header} data-context-menu-header data-menu-caption>
      <span className={styles.title} title={title}>
        {title}
      </span>
      {!compact && subtitle && (
        <span className={styles.subtitle} title={subtitle}>
          {subtitle}
        </span>
      )}
    </div>
  );
}
