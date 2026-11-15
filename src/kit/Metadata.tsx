import {
  createContext,
  useContext,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import styles from './Metadata.module.css';

/** 一项里截断文字的那一层；项里的内容据此判断自己放不放得下，项外为 null */
const ValueContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function useMetadataValue(): RefObject<HTMLElement | null> | null {
  return useContext(ValueContext);
}

export function Metadata({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`${styles.root} ${className ?? ''}`} {...rest}>
      {children}
    </span>
  );
}

interface MetadataItemProps extends HTMLAttributes<HTMLSpanElement> {
  /** 不给图标时，这一项只有文字，由所在行自己画分隔 */
  readonly icon?: ReactNode;
  /** 值本身没有写出字段名时给的名称：有图标时命名图标，没有图标时命名这一项 */
  readonly label?: string;
}

export function MetadataItem({ icon, label, children, className, ...rest }: MetadataItemProps) {
  const value = useRef<HTMLSpanElement>(null);
  return (
    <span
      className={`${styles.item} ${className ?? ''}`}
      role={!icon && label ? 'group' : undefined}
      aria-label={icon ? undefined : label}
      {...rest}
    >
      {icon && (
        <span
          className={styles.icon}
          role={label ? 'img' : undefined}
          aria-label={label}
          aria-hidden={label ? undefined : true}
        >
          {icon}
        </span>
      )}
      <span ref={value} className={styles.value}>
        <ValueContext value={value}>{children}</ValueContext>
      </span>
    </span>
  );
}
