import { ChevronDown16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createFlowFold, followersOf, partsOf } from '../../motion/flowFold.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { PANE_ONLY_ATTR } from './paneFades.ts';
import styles from './SidebarSection.module.css';

export interface SidebarSectionProps {
  readonly label: string;
  readonly expanded: boolean;
  onToggle(): void;
  /**
   * 为假时标题行只是标题、不能开合，节里的项一直画：图标态弹出的列表浮层就是这一节本身，不再收起。
   * 缺省为真。
   */
  readonly collapsible?: boolean;
  /** 标题行右端的工具键，例如播放列表节的放大镜。 */
  readonly tools?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 节里的项在不在文档里。开合照 Expander（`flowFold.ts`）：项从标题下面滑出、滑回去，下面的内容同步让位、
 * 补位。收起播完才卸掉，所以比 `open` 晚一步变假；展开时当场放回文档。
 */
function useFoldPresence(
  open: boolean,
  body: RefObject<HTMLDivElement | null>,
  toggle: RefObject<HTMLButtonElement | null>,
): boolean {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const [fold] = useState(() =>
    createFlowFold({
      open,
      body: () => body.current,
      followers: followersOf,
      parts: partsOf,
      onClosed: () => setPresent(false),
    }),
  );
  useLayoutEffect(() => {
    // 焦点在要收起的项上时交给开合键，不让它随项一起消失、落回 body。
    if (!open && body.current?.contains(document.activeElement)) toggle.current?.focus();
    fold.set(open, reduced);
  }, [fold, open, reduced, body, toggle]);
  useLayoutEffect(() => () => fold.dispose(), [fold]);
  return present;
}

/**
 * 侧边栏的一个分节：标题行点了开合，开合由调用方持有并落盘。
 *
 * 工具键与开合键是兄弟而不是嵌套：按钮里不能再放按钮，所以开合键铺满整行，工具键叠在它右端、
 * 箭头之前。收起播完后节里的项不渲染。图标态的窗格里没有标题行，侧边栏在展开与图标态之间切换时它淡出淡入
 * （`paneFades.ts`）。
 */
export function SidebarSection({
  label,
  expanded,
  onToggle,
  collapsible = true,
  tools,
  className,
  children,
}: SidebarSectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const bodyId = useId();
  const open = !collapsible || expanded;
  const body = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const present = useFoldPresence(open, body, toggle);
  return (
    <div
      className={className ? `${styles.section} ${className}` : styles.section}
      role="group"
      aria-label={label}
    >
      <div className={styles.head} {...{ [PANE_ONLY_ATTR]: true }}>
        {collapsible ? (
          <button
            ref={toggle}
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={t('sidebar.toggleSection', { name: label })}
            onClick={onToggle}
          >
            <span className={styles.label}>{label}</span>
            <ChevronDown16Regular className={styles.chevron} />
          </button>
        ) : (
          <div className={styles.title}>
            <span className={styles.label}>{label}</span>
          </div>
        )}
        {tools && (
          <div className={collapsible ? styles.tools : `${styles.tools} ${styles.bare}`}>
            {tools}
          </div>
        )}
      </div>
      {present && (
        <div ref={body} id={bodyId} className={styles.body}>
          {children}
        </div>
      )}
    </div>
  );
}
