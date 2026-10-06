import type { MenuCommand, MenuItem } from 'foo-webview-sdk';
import type { ContextMenuEntry } from '../kit/context-menu/contextMenuItems.ts';
import type { Translate } from '../i18n/translate.ts';

export interface CoveredCommand {
  readonly command: MenuCommand | null;
  readonly label: string;
}

/** 保留宿主树的层级与身份；没有稳定语义声明时不按名称删除命令。 */
export function contextMenuEntries(
  items: readonly MenuItem[],
  run: (command: MenuCommand) => void,
  covered: readonly CoveredCommand[] = [],
  parent = 'host',
  t?: Translate,
): ContextMenuEntry[] {
  return items.flatMap((item, index): ContextMenuEntry[] => {
    const id = `${parent}:${index}`;
    if (item.type === 'separator') return [{ kind: 'separator', id }];
    const label = item.displayLabel || item.label;
    if (item.type === 'submenu') {
      return [
        {
          kind: 'submenu',
          id,
          label,
          items: contextMenuEntries(item.children, run, covered, id, t),
        },
      ];
    }
    if (item.hidden) return [];
    const delegated = covered.find(
      ({ command }) =>
        command === item ||
        (command?.guid !== undefined &&
          command.guid.toLowerCase() === item.guid?.toLowerCase() &&
          command.subGuid?.toLowerCase() === item.subGuid?.toLowerCase()),
    );
    const reason = delegated
      ? 'context.coveredCommand'
      : item.enabled === false || item.available === false
        ? 'context.hostUnavailable'
        : typeof item.commandId !== 'number'
          ? 'context.commandUnaddressable'
          : null;
    return [
      {
        kind: 'command',
        id,
        label,
        disabled: reason !== null,
        reason: reason ? t?.(reason, { command: delegated?.label ?? '' }) : undefined,
        checked: item.radioChecked || item.checked,
        check: item.radioChecked ? 'radio' : item.checked ? 'checkbox' : undefined,
        onSelect: () => run(item),
      },
    ];
  });
}

export function contextExtensionEntries(
  t: Translate,
  tree: {
    readonly roots: readonly MenuItem[];
    readonly target: unknown;
    readonly failed?: boolean;
    readonly loading?: boolean;
  },
  run: (command: MenuCommand) => void,
  limited = false,
  retry?: () => void,
  covered: readonly CoveredCommand[] = [],
): ContextMenuEntry[] {
  if (limited) return [{ kind: 'status', id: 'host-limit', label: t('context.limited') }];
  if (tree.failed)
    return [
      { kind: 'status', id: 'host-failed', label: t('context.failed') },
      ...(retry
        ? [
            {
              kind: 'command' as const,
              id: 'host-retry',
              label: t('menu.retry'),
              keepOpen: true,
              onSelect: retry,
            },
          ]
        : []),
    ];
  if (!tree.target && tree.loading !== false)
    return [{ kind: 'status', id: 'host-loading', label: t('context.loading') }];
  return contextMenuEntries(tree.roots, run, covered, 'host', t);
}
