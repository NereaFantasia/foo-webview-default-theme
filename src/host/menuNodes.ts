import type { DiscoveryGetMainMenuCommandsResponse, MenuTreeNode } from 'foo-webview-sdk';

/**
 * 宿主菜单树节点的渲染与展示判据（基于 SDK 的 `MenuTreeNode` 统一表示分隔符、子菜单与命令）
 */
export type MenuNode = MenuTreeNode;

export function labelOf(node: MenuNode): string {
  return node.displayLabel || node.label || '';
}

/**
 * 判断菜单项是否处于勾选激活状态（包含普通复选与单选）
 * 仅在属性明确为 true 时渲染勾选标记；对于不可勾选或未勾选项宿主均返回 false
 */
export function isChecked(node: MenuNode): boolean {
  return node.checked === true || node.radioChecked === true;
}

/** 判断菜单项是否可交互；仅当属性明确为 false 时置为禁用置灰状态 */
export function isEnabled(node: MenuNode): boolean {
  return node.enabled !== false && node.available !== false;
}

/**
 * 提取主菜单命令的唯一执行凭据（标准 GUID，动态子命令额外包含 `subGuid`）
 * 忽略临时性的 `commandId` 以免菜单重建导致执行偏移；无 GUID 的节点不可执行
 */
export function addressOf(node: MenuNode): { command: string; subGuid?: string } | null {
  if (node.type !== 'command' || node.executable === false || !node.guid) return null;
  return node.subGuid ? { command: node.guid, subGuid: node.subGuid } : { command: node.guid };
}

/**
 * 过滤并规范化单层子菜单节点列表
 * 剔除宿主标记为隐藏的节点，并自动折叠首尾及连续多余的分隔线
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

/** 生成菜单列表渲染的唯一 Key，通过节点标识结合层内序号避免同层重名冲突 */
export function keyOf(node: MenuNode, index: number): string {
  return node.type === 'separator'
    ? `separator:${index}`
    : `${node.type}:${node.path ?? ''}:${index}`;
}

/**
 * 命令枚举里 fb2k 默认不显示的命令 GUID，统一大写。原生菜单要按住 Shift 打开才出现这些命令；
 * 菜单树的 HMENU 档按 Win32 菜单状态报 `hidden`，恒为假，只能拿枚举里的标记回头对
 * 只收静态槽：动态子菜单的容器藏起来时，HMENU 档里它展开的子项带的也是容器的 GUID
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
  /** 拿掉默认隐藏项后的树；子菜单因此一项不剩就一并拿掉，宿主本来就给的空子菜单照留 */
  readonly shown: MenuNode[];
  /** 拿掉的项，保留原来的子菜单层级。`hidden` 清掉了，否则 `visibleNodes` 会把它们滤光 */
  readonly tucked: MenuNode[];
}

/** 把默认隐藏的命令从各根里拿出来，收进菜单末尾的「更多」。认不出的（没有 GUID）照常显示 */
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
