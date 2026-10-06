import type { ReactElement } from 'react';

interface ContextItemLabel {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactElement;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly reason?: string;
  readonly data?: Readonly<Record<`data-${string}`, string | number>>;
}

export interface ContextMenuCommand extends ContextItemLabel {
  readonly kind: 'command';
  readonly checked?: boolean;
  readonly check?: 'radio' | 'checkbox';
  readonly onSelect: () => void;
  readonly keepOpen?: boolean;
}

export interface ContextMenuBranch extends ContextItemLabel {
  readonly kind: 'submenu';
  readonly items: readonly ContextMenuEntry[];
}

export interface ContextMenuSeparator {
  readonly kind: 'separator';
  readonly id: string;
}

export interface ContextMenuStatus {
  readonly kind: 'status';
  readonly id: string;
  readonly label: string;
}

export type ContextMenuEntry =
  ContextMenuCommand | ContextMenuBranch | ContextMenuSeparator | ContextMenuStatus;

/** 只压缩分隔线，不猜测命令语义或丢弃空子菜单。 */
export function contextMenuItems(items: readonly ContextMenuEntry[]): ContextMenuEntry[] {
  const result: ContextMenuEntry[] = [];
  for (const item of items) {
    if (item.kind === 'separator' && (!result.length || result.at(-1)?.kind === 'separator')) {
      continue;
    }
    result.push(item);
  }
  if (result.at(-1)?.kind === 'separator') result.pop();
  return result;
}

export function contextMenuChecks(items: readonly ContextMenuEntry[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'submenu'
      ? contextMenuChecks(item.items)
      : item.kind === 'command' && item.checked
        ? [item.id]
        : [],
  );
}
