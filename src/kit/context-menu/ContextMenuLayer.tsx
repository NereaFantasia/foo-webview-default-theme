import {
  Button,
  MenuDivider,
  MenuList,
  MenuPopover,
  type MenuProps,
} from '@fluentui/react-components';
import { ArrowLeft20Regular } from '@fluentui/react-icons';
import { useLayoutEffect, useRef, useState } from 'react';
import { ContextMenuEntryView } from './ContextMenuEntryView.tsx';
import { ContextMenuHeader } from './ContextMenuHeader.tsx';
import { ContextMenuSubmenu } from './ContextMenuSubmenu.tsx';
import {
  CONTEXT_MENU_WIDTH,
  contextMenuBounds,
  contextMenuCascadeWidth,
  type ContextMenuViewport,
} from './contextMenuGeometry.ts';
import {
  contextMenuItems,
  type ContextMenuBranch,
  type ContextMenuCommand,
  type ContextMenuEntry,
} from './contextMenuItems.ts';
import { pageContextMenu, revealContextMenuItem } from './contextMenuKeyboard.ts';
import { useContextMenuStyles } from './contextMenuStyles.ts';

export interface ContextMenuLayerProps {
  readonly owner: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly ContextMenuEntry[];
  readonly viewport: ContextMenuViewport;
  readonly backLabel: string;
  readonly surfaceMotion?: MenuProps['surfaceMotion'];
  readonly widthLimit?: number;
  readonly surfaceAttributes?: Readonly<Record<`data-${string}`, string | boolean>>;
  readonly onInvoke: (entry: ContextMenuCommand) => void;
  readonly onBack?: () => void;
}

interface MenuLevel {
  readonly id: string;
  readonly scroll: number;
}

export function ContextMenuLayer(props: ContextMenuLayerProps) {
  const classes = useContextMenuStyles();
  const surface = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [levels, setLevels] = useState<readonly MenuLevel[]>([]);
  const [spacing, setSpacing] = useState({ edge: 12, gap: 4 });
  const [cascadeWidth, setCascadeWidth] = useState(0);
  const bounds = contextMenuBounds(props.viewport, spacing.edge);
  const width = Math.min(bounds.width, props.widthLimit ?? bounds.width);
  const restore = useRef<MenuLevel | null>(null);
  let items = props.items;
  let title = props.title;
  let validDepth = 0;
  for (const level of levels) {
    const entry = items.find((item) => item.id === level.id);
    if (entry?.kind !== 'submenu' || entry.disabled) break;
    items = entry.items;
    title = entry.label;
    validDepth += 1;
  }
  useLayoutEffect(() => {
    if (validDepth < levels.length) setLevels(levels.slice(0, validDepth));
  }, [validDepth, levels]);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && list.current?.contains(active)) {
      revealContextMenuItem(list.current, active);
    }
  }, [bounds.width, bounds.height]);
  const back = () => {
    const previous = levels.at(-1);
    if (!previous) return props.onBack?.();
    restore.current = previous;
    setLevels(levels.slice(0, -1));
  };
  const drill = (entry: ContextMenuBranch) => {
    setLevels([...levels, { id: entry.id, scroll: list.current?.scrollTop ?? 0 }]);
  };

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const edge = parseFloat(style.getPropertyValue('--spacingHorizontalM')) || 12;
    const gap = parseFloat(style.getPropertyValue('--spacingHorizontalXS')) || 4;
    setSpacing({ edge, gap });
    const measure = () =>
      setCascadeWidth(
        contextMenuCascadeWidth(element.getBoundingClientRect(), props.viewport, edge, gap),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [props.viewport, title, levels.length]);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const saved = restore.current;
    restore.current = null;
    element.scrollTop = saved?.scroll ?? 0;
    const candidates = [...element.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const target = saved
      ? candidates.find((item) => item.dataset.contextCommand === saved.id)
      : candidates.find((item) => item.getAttribute('aria-disabled') !== 'true');
    target?.focus({ preventScroll: true });
  }, [levels]);

  const header = (
    <ContextMenuHeader
      title={title}
      subtitle={levels.length ? undefined : props.subtitle}
      compact={bounds.height < 220}
    />
  );
  return (
    <MenuPopover
      {...props.surfaceAttributes}
      ref={surface}
      className={classes.surface}
      style={{
        maxWidth: width,
        minWidth: Math.min(CONTEXT_MENU_WIDTH, width),
        maxHeight: bounds.height,
      }}
      data-context-menu-owner={props.owner}
      data-context-menu-layer={levels.length ? 'inline' : 'cascade'}
      onKeyDownCapture={(event) => {
        if (!(event.target instanceof Node) || !surface.current?.contains(event.target)) return;
        if ((event.key === 'Escape' || event.key === 'ArrowLeft') && levels.length) {
          event.preventDefault();
          event.stopPropagation();
          back();
        }
      }}
    >
      {bounds.height >= 140 && header}
      {(levels.length > 0 || props.onBack) && (
        <Button
          className={classes.back}
          appearance="subtle"
          icon={<ArrowLeft20Regular />}
          onClick={back}
          data-context-back
        >
          {props.backLabel}
        </Button>
      )}
      <MenuList
        ref={list}
        className={classes.list}
        aria-label={title}
        data-context-commands
        onKeyDownCapture={pageContextMenu}
        onFocusCapture={(event) => {
          const target = event.target.closest<HTMLElement>('[role^="menuitem"]');
          if (target && list.current?.contains(target)) revealContextMenuItem(list.current, target);
        }}
      >
        {bounds.height < 140 && header}
        {contextMenuItems(items).map((entry) => {
          if (entry.kind === 'separator') return <MenuDivider key={entry.id} />;
          if (entry.kind === 'status') {
            return (
              <div key={entry.id} role="status">
                {entry.label}
              </div>
            );
          }
          if (entry.kind === 'submenu') {
            return (
              <ContextMenuSubmenu
                key={entry.id}
                {...props}
                entry={entry}
                cascadeWidth={cascadeWidth}
                scrollParent={list}
                onDrill={drill}
              >
                <ContextMenuLayer
                  {...props}
                  title={entry.label}
                  subtitle={undefined}
                  items={entry.items}
                  widthLimit={cascadeWidth}
                  onBack={undefined}
                  surfaceAttributes={undefined}
                />
              </ContextMenuSubmenu>
            );
          }
          return <ContextMenuEntryView key={entry.id} entry={entry} onInvoke={props.onInvoke} />;
        })}
      </MenuList>
    </MenuPopover>
  );
}
