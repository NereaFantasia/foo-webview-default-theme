import type { DiscoveryGetMainMenuCommandsResponse, MenuTreeNode } from 'foo-webview-sdk';

/**
 * 宿主菜单树的呈现判据。节点的形状取自 SDK 的 `MenuTreeNode`：分隔符、子菜单与命令共用一个类型，
 * 靠 `type` 区分。主菜单与以后的曲目右键菜单共用这里。
 */
export type MenuNode = MenuTreeNode;

export function labelOf(node: MenuNode): string {
  return node.displayLabel || node.label || '';
}

/**
 * 只有明确为真才呈现勾选：`checked: false` 既可能是这项不可勾选，也可能是可勾选但没勾，
 * 宿主两种都答 false。按真值呈现不会造出宿主没说过的状态，代价是没勾的可勾选项看着像普通命令。
 */
export function isChecked(node: MenuNode): boolean {
  return node.checked === true || node.radioChecked === true;
}

/** 缺字段不等于禁用：只有明确答 false 才置灰。 */
export function isEnabled(node: MenuNode): boolean {
  return node.enabled !== false && node.available !== false;
}

/**
 * 主菜单命令的执行地址只用 GUID，动态子项另带 `subGuid`，两者成对发出。
 * `commandId` 随那一次生成的菜单作废，不存也不回传；没有 GUID 的命令执行不了。
 */
export function addressOf(node: MenuNode): { command: string; subGuid?: string } | null {
  if (node.type !== 'command' || node.executable === false || !node.guid) return null;
  return node.subGuid ? { command: node.guid, subGuid: node.subGuid } : { command: node.guid };
}

/**
 * 一层子节点的呈现清单：去掉宿主标了不显示的命令，再折叠首尾与连续的分隔符。
 * 折叠只清理过滤后留下的空档，不增删宿主给的命令。
 */
export function visibleNodes(nodes: readonly MenuNode[] | undefined): MenuNode[] {
  const shown: MenuNode[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'command' && node.hidden === true) continue;
    if (node.type === 'separator' && (shown.length === 0 || shown.at(-1)?.type === 'separator')) {
      continue;
    }
    shown.push(node);
  }
  while (shown.at(-1)?.type === 'separator') shown.pop();
  return shown;
}

/** 列表渲染的键：同一层里 path 可能重名（扁平回退档尤其），带上序号才稳。 */
export function keyOf(node: MenuNode, index: number): string {
  return node.type === 'separator'
    ? `separator:${index}`
    : `${node.type}:${node.path ?? ''}:${index}`;
}

/**
 * 命令枚举里 fb2k 默认不显示的命令 GUID，统一大写。原生菜单要按住 Shift 打开才出现这些命令；
 * 菜单树的 HMENU 档按 Win32 菜单状态报 `hidden`，恒为假，只能拿枚举里的标记回头对。
 * 只收静态槽：动态子菜单的容器藏起来时，HMENU 档里它展开的子项带的也是容器的 GUID。
 */
export function hiddenGuidsOf(answer: DiscoveryGetMainMenuCommandsResponse | null): Set<string> {
  const guids = new Set<string>();
  if (!answer || answer.success === false) return guids;
  for (const entry of answer.commands) {
    if (entry.hidden && entry.guid && !entry.subGuid) guids.add(entry.guid.toUpperCase());
  }
  return guids;
}

export interface MenuSplit {
  /** 拿掉默认隐藏项后的树；子菜单因此一项不剩就一并拿掉，宿主本来就给的空子菜单照留。 */
  readonly shown: MenuNode[];
  /** 拿掉的项，保留原来的子菜单层级。`hidden` 清掉了，否则 `visibleNodes` 会把它们滤光。 */
  readonly tucked: MenuNode[];
}

/** 把默认隐藏的命令从各根里拿出来，收进菜单末尾的「更多」。认不出的（没有 GUID）照常显示。 */
export function splitDefaultHidden(
  nodes: readonly MenuNode[],
  hiddenGuids: ReadonlySet<string>,
): MenuSplit {
  const shown: MenuNode[] = [];
  const tucked: MenuNode[] = [];
  for (const node of nodes) {
    if (node.type === 'command') {
      const hidden =
        node.hidden === true || (!!node.guid && hiddenGuids.has(node.guid.toUpperCase()));
      if (hidden) tucked.push({ ...node, hidden: false });
      else shown.push(node);
    } else if (node.type === 'submenu') {
      const children = node.children ?? [];
      const inner = splitDefaultHidden(children, hiddenGuids);
      if (children.length === 0 || inner.shown.some((child) => child.type !== 'separator')) {
        shown.push({ ...node, children: inner.shown });
      }
      if (inner.tucked.length > 0) tucked.push({ ...node, children: inner.tucked });
    } else {
      shown.push(node);
    }
  }
  return { shown, tucked };
}
