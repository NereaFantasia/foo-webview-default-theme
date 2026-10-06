import { Menu, type MenuProps } from '@fluentui/react-components';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenuLayer } from './ContextMenuLayer.tsx';
import type { ContextMenuPoint } from './contextMenuGeometry.ts';
import { contextMenuChecks, type ContextMenuEntry } from './contextMenuItems.ts';
import { useContextMenuViewport } from './useContextMenuViewport.ts';

export type ContextMenuCloseReason = 'dismiss' | 'invoke' | 'invalidated';

export interface ContextMenuProps {
  readonly at: ContextMenuPoint | null;
  /** 标识操作对象及其顺序；元数据刷新不改变它。 */
  readonly targetKey: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly ContextMenuEntry[];
  readonly backLabel: string;
  readonly surfaceMotion?: MenuProps['surfaceMotion'];
  readonly surfaceAttributes?: Readonly<Record<`data-${string}`, string | boolean>>;
  /** 执行前检查最新对象状态；不代替宿主的最终校验。 */
  readonly isCurrent?: () => boolean;
  readonly onClose: (reason: ContextMenuCloseReason) => void;
}

export function ContextMenu(props: ContextMenuProps) {
  return props.at ? <ContextMenuSession {...props} at={props.at} /> : null;
}

function ContextMenuSession(props: ContextMenuProps & { readonly at: ContextMenuPoint }) {
  const owner = useId();
  const viewport = useContextMenuViewport();
  const originalKey = useRef(props.targetKey);
  const [returnTo] = useState(() => document.activeElement);
  const [closed, setClosed] = useState(false);
  const mounted = useRef(false);
  const current = props.targetKey === originalKey.current && (props.isCurrent?.() ?? true);
  const latestClose = useRef(props.onClose);
  useLayoutEffect(() => {
    latestClose.current = props.onClose;
  });
  useLayoutEffect(() => {
    if (!current && !closed) {
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
    if (closed) return;
    setClosed(true);
    props.onClose(reason);
  };
  if (closed || !current) return null;
  return (
    <Menu
      open
      surfaceMotion={props.surfaceMotion}
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
          if (!(props.isCurrent?.() ?? true)) return close('invalidated');
          entry.onSelect();
          if (!entry.keepOpen) close('invoke');
        }}
      />
    </Menu>
  );
}
