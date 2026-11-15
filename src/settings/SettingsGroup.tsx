import type { ReactNode } from 'react';
import { SettingsGroupContext } from './expanderMemory.ts';
import styles from './SettingsGroup.module.css';

/** 组的锚点 id，也是标题 id 的前缀。整个文档里要唯一，所以带前缀 */
export function groupAnchor(group: string): string {
  return `settings-${group}`;
}

/** 标题的 id：深链落地时把焦点放到它上 */
export function groupTitleId(group: string): string {
  return `${groupAnchor(group)}-title`;
}

export interface SettingsGroupProps {
  /** 组名，同一页里不重复 */
  readonly group: string;
  readonly title: string;
  /** 标题已由别处写出（窄页里目录就是标题）：只留给读屏与程序焦点，不画出来 */
  readonly titleHidden?: boolean;
  readonly children: ReactNode;
}

/** 一组设置：组标题加下面的几张卡。标题能接程序给的焦点，从别处跳来时读屏从这里读起 */
export function SettingsGroup({ group, title, titleHidden = false, children }: SettingsGroupProps) {
  const titleId = groupTitleId(group);
  return (
    <section
      id={groupAnchor(group)}
      className={styles.root}
      aria-labelledby={titleId}
      data-settings-group={group}
    >
      <h2
        id={titleId}
        className={titleHidden ? `${styles.title} ${styles.hidden}` : styles.title}
        tabIndex={-1}
      >
        {title}
      </h2>
      <SettingsGroupContext value={group}>{children}</SettingsGroupContext>
    </section>
  );
}
