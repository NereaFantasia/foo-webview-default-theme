import { MenuItem, MenuItemCheckbox, MenuItemRadio, Tooltip } from '@fluentui/react-components';
import type { ContextMenuCommand } from './contextMenuItems.ts';
import { useContextMenuStyles } from './contextMenuStyles.ts';

export interface ContextMenuEntryViewProps {
  readonly entry: ContextMenuCommand;
  readonly onInvoke: (entry: ContextMenuCommand) => void;
}

export function ContextMenuEntryView({ entry, onInvoke }: ContextMenuEntryViewProps) {
  const classes = useContextMenuStyles();
  const props = {
    ...entry.data,
    className: classes.item,
    icon: entry.icon,
    disabled: entry.disabled,
    content: { className: classes.content },
    secondaryContent: { className: classes.secondary, children: entry.detail },
    'data-context-command': entry.id,
    'data-action': entry.id,
    // 先交付命令再关闭；Fluent 的预先关闭会使调用方绑定的操作对象失效。
    persistOnClick: true,
    onClick: () => {
      if (!entry.disabled) onInvoke(entry);
    },
    children: entry.label,
  };
  const item =
    entry.check === 'radio' ? (
      <MenuItemRadio {...props} name="context" value={entry.id} />
    ) : entry.check === 'checkbox' ? (
      <MenuItemCheckbox {...props} name="context" value={entry.id} />
    ) : (
      <MenuItem {...props} />
    );
  return (
    <Tooltip
      content={{ children: entry.reason || entry.label, className: classes.tooltip }}
      relationship="description"
    >
      {item}
    </Tooltip>
  );
}
