import { useMergedRefs, type PresenceComponentProps } from '@fluentui/react-components';
import { createContext, useContext, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { SurfacePresence } from '../motion/SurfacePresence.tsx';
import styles from './SidePanel.module.css';

const PanelHost = createContext<HTMLElement | null | undefined>(undefined);

interface SidePanelHostProps extends ComponentProps<'div'> {
  readonly compact: boolean;
}

/** 页面里的面板也挂在内容区根部，避开页面滚动、裁剪和切换位移。 */
export function SidePanelHost({ ref, compact, className, children, ...props }: SidePanelHostProps) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const hostRef = useMergedRefs(ref, setNode);
  return (
    <div
      {...props}
      ref={hostRef}
      className={`${styles.host} ${className ?? ''}`}
      data-side-panel-host
      data-side-panel-compact={compact || undefined}
    >
      <PanelHost value={node}>{children}</PanelHost>
    </div>
  );
}

interface SidePanelProps extends ComponentProps<'div'> {
  readonly open: boolean;
  readonly side: 'start' | 'end';
  readonly onMotionStart?: PresenceComponentProps['onMotionStart'];
  readonly onMotionFinish?: PresenceComponentProps['onMotionFinish'];
}

/** 共用外框和进退场；开合、内容、焦点及轻关闭由调用方提供。 */
export function SidePanel({
  open,
  side,
  onMotionStart,
  onMotionFinish,
  className,
  ...props
}: SidePanelProps) {
  const host = useContext(PanelHost);
  if (host === undefined) throw new Error('侧向面板缺少内容区容器');
  if (host === null) return null;
  return createPortal(
    <SurfacePresence
      kind={side}
      visible={open}
      appear
      unmountOnExit
      onMotionStart={onMotionStart}
      onMotionFinish={onMotionFinish}
    >
      <div {...props} className={`${styles.panel} ${className ?? ''}`} data-side-panel={side} />
    </SurfacePresence>,
    host,
  );
}
