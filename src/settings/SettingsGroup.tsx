import type { ReactNode } from 'react';
import styles from './SettingsGroup.module.css';
import { GROUP_ATTR, groupAnchor } from './useSettingsNav.ts';

export interface SettingsGroupProps {
  /** 组名，目录里的那一项按它找到这一组；同一页里不重复。 */
  readonly group: string;
  readonly title: string;
  readonly children: ReactNode;
}

/** 一组设置：组标题加下面的几张卡。标题能接程序给的焦点，点目录跳过来时读屏从这里读起。 */
export function SettingsGroup({ group, title, children }: SettingsGroupProps) {
  const anchor = groupAnchor(group);
  const titleId = `${anchor}-title`;
  return (
    <section
      id={anchor}
      className={styles.root}
      aria-labelledby={titleId}
      {...{ [GROUP_ATTR]: group }}
    >
      <h2 id={titleId} className={styles.title} tabIndex={-1}>
        {title}
      </h2>
      {children}
    </section>
  );
}
