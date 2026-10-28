import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Metadata.module.css';

export function Metadata({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`${styles.root} ${className ?? ''}`} {...rest}>
      {children}
    </span>
  );
}

interface MetadataItemProps extends HTMLAttributes<HTMLSpanElement> {
  readonly icon: ReactNode;
  /** 值本身没有写出字段名时，为图标提供名称 */
  readonly label?: string;
}

export function MetadataItem({ icon, label, children, className, ...rest }: MetadataItemProps) {
  return (
    <span className={`${styles.item} ${className ?? ''}`} {...rest}>
      <span
        className={styles.icon}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        {icon}
      </span>
      <span className={styles.value}>{children}</span>
    </span>
  );
}
