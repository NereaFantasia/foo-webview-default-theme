import type { MenuCommand, MenuItem, MenuSubmenu } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { settle } from './hostCall.ts';
import { isEnabled } from './menuNodes.ts';

// 宿主给一批曲目的上下文命令树（「更多命令」子菜单），以及从树里认出的几条命令。
//
// 执行走 `runContextCommandById(id, 目标)`，宿主会重建树；当前契约没有保证两次建树的编号稳定。
// 每次打开都重读并绑定目标，不能将本地对象校验视为宿主命令快照。

/**
 * 对着什么生成：宿主活动列表的选中，或一批路径（`path` 或 `path|subsong:N`）。按路径生成时宿主逐条
 * 校验，网络共享上明显慢，调用方按条数设上限。
 */
export type ContextTarget =
  | { readonly mode: 'selection' }
  | { readonly mode: 'handles'; readonly handles: readonly string[] };

export interface ContextMenuFace {
  menu: Pick<typeof fb.menu, 'getContextMenu' | 'runContextCommandById'>;
}

export interface ContextTree {
  readonly roots: readonly MenuItem[];
  readonly failed?: boolean;
  readonly loading?: boolean;
  /** 生成这棵树时用的目标；空树为 null，其中的命令都执行不了。 */
  readonly target: ContextTarget | null;
}

export const EMPTY_CONTEXT_TREE: ContextTree = { roots: [], target: null };
export const FAILED_CONTEXT_TREE: ContextTree = { ...EMPTY_CONTEXT_TREE, failed: true };

/** SDK 的参数要可变数组，复制一份，不把调用方的只读数组交出去。 */
function targetParams(target: ContextTarget): { mode: string; handles?: string[] } {
  return target.mode === 'handles' ? { mode: 'handles', handles: [...target.handles] } : target;
}

/**
 * 读一棵命令树。失败与正常空树分别标记，自绘的几项不受影响。
 * `locale` 给了时宿主按它翻译常见标签，填进 `displayLabel`；认命令只看原始 `label`。
 */
export async function readContextTree(
  host: ContextMenuFace,
  target: ContextTarget,
  locale?: string,
): Promise<ContextTree> {
  const params = { ...targetParams(target), ...(locale ? { locale } : {}) };
  const answer = await settle(() => host.menu.getContextMenu(params));
  if (!answer || answer.success === false) return FAILED_CONTEXT_TREE;
  return { roots: answer.items, target };
}

/**
 * 执行树里的一条命令，目标是生成这棵树时的那一份。空树、没有编号或已置灰的不发；
 * 宿主答失败或调用出错答 false。
 */
export async function runContextCommand(
  host: ContextMenuFace,
  tree: ContextTree,
  node: MenuCommand,
): Promise<boolean> {
  const { target } = tree;
  if (!target || typeof node.commandId !== 'number' || !isEnabled(node)) return false;
  const id = node.commandId;
  const answer = await settle(() => host.menu.runContextCommandById(id, targetParams(target)));
  return !!answer && answer.success !== false;
}

/** 认命令用的标签：去掉助记符 `&`、尾部省略号与两端空白，ASCII 折小写。 */
export function normalizeLabel(label: string): string {
  return label
    .replace(/&/g, '')
    .replace(/(?:\.\.\.|…)\s*$/, '')
    .trim()
    .toLowerCase();
}

/** 要认的命令标签，比对前都过 `normalizeLabel`：中文是汉化版取回的写法，英文按 fb2k 原文。 */
const LABELS = {
  properties: ['properties', '属性'],
  sendToPlaylist: ['send to playlist', '发送到播放列表'],
};
const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export interface RatingCommands {
  /** 1–5 各档与树里对应的叶子。 */
  readonly values: readonly { readonly value: number; readonly node: MenuCommand }[];
  /** 宿主的「未设置」一项，标签形如 `<…>`；没有就不提供清除。 */
  readonly clear: MenuCommand | null;
  /** 宿主勾在哪一档：1–5，勾在「未设置」上是 0，哪档都没勾是 null。只照搬宿主的勾选。 */
  readonly current: number | null;
}

export interface KnownCommands {
  readonly properties: MenuCommand | null;
  /** 宿主的「发送到播放列表…」对话框，行数太多不便自己列目标时用。 */
  readonly sendToDialog: MenuCommand | null;
  readonly rating: RatingCommands | null;
}

function collect(nodes: readonly MenuItem[], commands: MenuCommand[], submenus: MenuSubmenu[]) {
  for (const node of nodes) {
    if (node.type === 'command') commands.push(node);
    if (node.type === 'submenu') {
      submenus.push(node);
      collect(node.children, commands, submenus);
    }
  }
}

/** 恰好一条才算认出；同一标签匹到几条就当没有，不猜。 */
function only<T>(list: readonly T[]): T | null {
  return list.length === 1 ? (list[0] ?? null) : null;
}

/** 可用、带编号的才交出去。 */
function usable(node: MenuCommand | null): MenuCommand | null {
  return node && isEnabled(node) && typeof node.commandId === 'number' ? node : null;
}

/**
 * 评分子菜单靠子项认，不靠它自己的标签：「等级」「Rating」随宿主语言变，1–5 不变。
 * 恰有一个子菜单的命令子项覆盖这五个数字才算找到。
 */
function ratingOf(submenus: readonly MenuSubmenu[]): RatingCommands | null {
  const leavesOf = (menu: MenuSubmenu) =>
    menu.children.filter((child): child is MenuCommand => child.type === 'command');
  const menu = only(
    submenus.filter((candidate) => {
      const labels = new Set(leavesOf(candidate).map((leaf) => leaf.label.trim()));
      return RATING_VALUES.every((value) => labels.has(String(value)));
    }),
  );
  if (!menu) return null;
  const leaves = leavesOf(menu);
  const values = RATING_VALUES.flatMap((value) => {
    const node = leaves.find((leaf) => leaf.label.trim() === String(value));
    return node ? [{ value, node }] : [];
  });
  const clear = only(leaves.filter((leaf) => /^<.+>$/.test(leaf.label.trim())));
  const checked = (node: MenuCommand) => node.checked === true || node.radioChecked === true;
  const hit = values.find((entry) => checked(entry.node));
  const current = hit ? hit.value : clear && checked(clear) ? 0 : null;
  return { values, clear, current };
}

/** 从树里认出属性、发送到对话框与评分三样；认不出的为 null，对应的菜单项置灰。 */
export function knownCommandsOf(tree: ContextTree): KnownCommands {
  const commands: MenuCommand[] = [];
  const submenus: MenuSubmenu[] = [];
  collect(tree.roots, commands, submenus);
  const find = (labels: readonly string[]) =>
    usable(only(commands.filter((node) => labels.includes(normalizeLabel(node.label)))));
  return {
    properties: find(LABELS.properties),
    sendToDialog: find(LABELS.sendToPlaylist),
    rating: ratingOf(submenus),
  };
}

/**
 * 这条命令是不是评分的某一档：是就答它的值（清除答 0），不是答 null。「更多」里点到评分时，
 * 调用方据此像自绘的评分项那样先记下新值：宿主树要到下次打开才重读，期间勾选按记下的显示。
 */
export function ratingValueOf(rating: RatingCommands | null, node: MenuCommand): number | null {
  if (!rating || typeof node.commandId !== 'number') return null;
  const entry = rating.values.find((candidate) => candidate.node.commandId === node.commandId);
  if (entry) return entry.value;
  return rating.clear?.commandId === node.commandId ? 0 : null;
}
