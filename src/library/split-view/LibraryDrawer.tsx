import { Button, useFocusFinders, useRestoreFocusSource } from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { createContext, useId, useRef, useState, type ReactNode } from 'react';
import { SidePanel } from '../../kit/SidePanel.tsx';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import styles from './LibraryDrawer.module.css';

/** 未包在抽屉里时为 undefined；挂载中的标题工具插槽暂为 null。 */
export const LibraryDrawerToolsContext = createContext<HTMLElement | null | undefined>(undefined);

interface LibraryDrawerProps {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  onOpenChange(open: boolean): void;
}
export function LibraryDrawer(props: LibraryDrawerProps) {
  const id = useId();
  const [tools, setTools] = useState<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRestoreFocusSource();
  const { findFirstFocusable } = useFocusFinders();
  const markInside = useLightDismiss({
    id: `library.drawer.${id}`,
    open: props.open,
    panel,
    escapeFromInput: true,
    exempt: (target) => opener.current?.contains(target) ?? false,
    onDismiss: () => props.onOpenChange(false),
  });
  return (
    <LibraryDrawerToolsContext value={tools}>
      <SidePanel
        {...restoreFocus}
        ref={panel}
        className={styles.drawer}
        side="start"
        open={props.open}
        role="dialog"
        aria-labelledby={id}
        data-library-drawer
        onPointerDownCapture={markInside}
        onMotionStart={(_, { direction }) => {
          const node = panel.current;
          if (direction !== 'enter' || !node) return;
          if (!node.contains(document.activeElement)) {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            (findFirstFocusable(node) ?? node).focus({ preventScroll: true });
          }
        }}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 id={id} className={styles.title}>
            {props.title}
          </h2>
          <div ref={setTools} className={styles.tools} />
          <Button
            appearance="transparent"
            icon={<Dismiss20Regular />}
            aria-label={props.closeLabel}
            onClick={() => props.onOpenChange(false)}
          />
        </header>
        <div className={styles.body}>{props.children}</div>
      </SidePanel>
    </LibraryDrawerToolsContext>
  );
}
