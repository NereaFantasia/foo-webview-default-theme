import { type MenuProps } from '@fluentui/react-components';
import { Menu } from '../../motion/Surfaces.tsx';
import { MENU_SURFACE_MOTION } from '../../motion/MenuMotion.tsx';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenuLayer } from './ContextMenuLayer.tsx';
import type { ContextMenuPoint } from './contextMenuGeometry.ts';
import { contextMenuChecks, type ContextMenuEntry } from './contextMenuItems.ts';
import { useContextMenuViewport } from './useContextMenuViewport.ts';

export type ContextMenuCloseReason = 'dismiss' | 'invoke' | 'invalidated';

export interface ContextMenuProps {
  readonly at: ContextMenuPoint | null;
  /** 标识操作对象及其顺序；元数据刷新不改变它 */
  readonly targetKey: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly ContextMenuEntry[];
  readonly backLabel: string;
  readonly surfaceMotion?: MenuProps['surfaceMotion'];
  readonly surfaceAttributes?: Readonly<Record<`data-${string}`, string | boolean>>;
  /** 执行前检查最新对象状态；不代替宿主的最终校验 */
  readonly isCurrent?: () => boolean;
  readonly onClose: (reason: ContextMenuCloseReason) => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const [session, setSession] = useState({ at: props.at, id: 0 });
  // 新落点对象代表一次打开请求，即使坐标相同也不能接上旧的退场回调
  if (session.at !== props.at) setSession({ at: props.at, id: session.id + 1 });
  return props.at ? <ContextMenuSession key={session.id} {...props} at={props.at} /> : null;
}

function ContextMenuSession(props: ContextMenuProps & { readonly at: ContextMenuPoint }) {
  const owner = useId();
  const viewport = useContextMenuViewport();
  const originalKey = useRef(props.targetKey);
  const [returnTo] = useState(() => document.activeElement);
  const [closed, setClosed] = useState(false);
  const closeReason = useRef<ContextMenuCloseReason | null>(null);
  const notified = useRef(false);
  const mounted = useRef(false);
  const current = props.targetKey === originalKey.current && (props.isCurrent?.() ?? true);
  const latestClose = useRef(props.onClose);
  useLayoutEffect(() => {
    latestClose.current = props.onClose;
  });
  useLayoutEffect(() => {
    if (!current && !notified.current) {
      notified.current = true;
      closeReason.current = 'invalidated';
      setClosed(true);
      latestClose.current('invalidated');
    }
  }, [current, closed]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        const active = document.activeElement;
        const layer = active?.closest<HTMLElement>('[data-context-menu-owner]');
        if (
          returnTo instanceof HTMLElement &&
          returnTo.isConnected &&
          (!active || active === document.body || layer?.dataset.contextMenuOwner === owner)
        ) {
          returnTo.focus({ preventScroll: true });
        }
      });
    };
  }, [owner, returnTo]);
  const target = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(props.at.x, props.at.y, 0, 0) }),
    [props.at.x, props.at.y],
  );
  const close = (reason: ContextMenuCloseReason) => {
    if (closeReason.current) return;
    closeReason.current = reason;
    setClosed(true);
    if (reason === 'invalidated') {
      notified.current = true;
      props.onClose(reason);
    }
  };
  if (!current) return null;
  return (
    <Menu
      open={!closed}
      surfaceMotion={{
        ...MENU_SURFACE_MOTION,
        ...props.surfaceMotion,
        onMotionFinish: (event, data) => {
          props.surfaceMotion?.onMotionFinish?.(event, data);
          if (data.direction === 'exit' && closeReason.current && !notified.current) {
            notified.current = true;
            props.onClose(closeReason.current);
          }
        },
      }}
      checkedValues={{ context: contextMenuChecks(props.items) }}
      onOpenChange={(_, data) => {
        if (!data.open) close('dismiss');
      }}
      positioning={{
        target,
        position: 'below',
        align: 'start',
        overflowBoundaryPadding: 12,
        shiftToCoverTarget: true,
      }}
    >
      <ContextMenuLayer
        {...props}
        owner={owner}
        viewport={viewport}
        onInvoke={(entry) => {
          if (closeReason.current) return;
          if (!(props.isCurrent?.() ?? true)) return close('invalidated');
          entry.onSelect();
          if (!entry.keepOpen) close('invoke');
        }}
      />
    </Menu>
  );
}
