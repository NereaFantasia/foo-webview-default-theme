import { Menu, MenuItem, MenuTrigger, Tooltip, type MenuProps } from '@fluentui/react-components';
import { ChevronRight16Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { CONTEXT_MENU_WIDTH } from './contextMenuGeometry.ts';
import { contextMenuChecks, type ContextMenuBranch } from './contextMenuItems.ts';
import { useContextMenuStyles } from './contextMenuStyles.ts';

interface ContextMenuSubmenuProps {
  readonly entry: ContextMenuBranch;
  readonly cascadeWidth: number;
  readonly scrollParent: RefObject<HTMLDivElement | null>;
  readonly onDrill: (entry: ContextMenuBranch) => void;
  readonly surfaceMotion?: MenuProps['surfaceMotion'];
  readonly children: ReactElement;
}

export function ContextMenuSubmenu(props: ContextMenuSubmenuProps) {
  const { entry, cascadeWidth, scrollParent, onDrill } = props;
  const classes = useContextMenuStyles();
  const trigger = useRef<HTMLDivElement>(null);
  const attachTrigger = useCallback((element: HTMLDivElement | null) => {
    // 同层与级联之间切换会替换触发项，焦点留在同一条命令上。
    const previous = trigger.current;
    if (!element && previous && document.activeElement === previous) {
      queueMicrotask(() => {
        if (document.activeElement === document.body || document.activeElement === previous)
          trigger.current?.focus({ preventScroll: true });
      });
    }
    trigger.current = element;
  }, []);
  const [open, setOpen] = useState(false);
  const compact = cascadeWidth < CONTEXT_MENU_WIDTH;
  useEffect(() => {
    const parent = scrollParent.current;
    if (!open || !parent) return;
    const check = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      if (!rect || rect.top < bounds.top || rect.bottom > bounds.bottom) setOpen(false);
    };
    parent.addEventListener('scroll', check);
    return () => parent.removeEventListener('scroll', check);
  }, [open, scrollParent]);
  useEffect(() => {
    if (compact && open) {
      setOpen(false);
      onDrill(entry);
    }
  }, [compact, open, entry, onDrill]);
  const item = (
    <MenuItem
      ref={attachTrigger}
      className={classes.item}
      content={{ className: classes.content }}
      icon={entry.icon}
      disabled={entry.disabled}
      aria-haspopup="menu"
      data-context-command={entry.id}
      data-action={entry.id}
      secondaryContent={compact ? <ChevronRight16Regular /> : entry.detail}
      persistOnClick
      onClick={() => {
        if (compact && !entry.disabled) onDrill(entry);
      }}
      onKeyDown={(event) => {
        if (compact && event.key === 'ArrowRight' && !entry.disabled) {
          event.preventDefault();
          event.stopPropagation();
          onDrill(entry);
        }
      }}
    >
      {entry.label}
    </MenuItem>
  );
  if (compact) {
    return (
      <Tooltip
        content={{ children: entry.reason || entry.label, className: classes.tooltip }}
        relationship="description"
      >
        {item}
      </Tooltip>
    );
  }
  return (
    <Menu
      open={open && !entry.disabled}
      onOpenChange={(_, data) => setOpen(data.open)}
      surfaceMotion={props.surfaceMotion}
      checkedValues={{ context: contextMenuChecks(entry.items) }}
      positioning={{ position: 'after', align: 'top', overflowBoundaryPadding: 12 }}
    >
      <MenuTrigger disableButtonEnhancement>{item}</MenuTrigger>
      {props.children}
    </Menu>
  );
}
