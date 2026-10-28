import type { MenuCommand, MenuItem, MenuSubmenu } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { settle } from './hostCall.ts';
import { isEnabled } from './menuNodes.ts';
import { batchAbilities } from './trackOrigin.ts';

// 宿主针对目标曲目集合生成的上下文菜单命令树（供「更多命令」等级联菜单使用），以及关键命令提取逻辑
//
// 命令调用通过 `runContextCommandById(id, target)` 触发；由于宿主每次执行时会动态重建命令树，
// 菜单项数字 ID 仅对应重建后的临时下标，若期间曲目、选区或已安装组件变动可能发生漂移
// 故执行命令时须同时回传节点的 `path` 与当前树的校验指纹 `targetKey`，若校验不符宿主将拒绝执行

/**
 * 菜单目标范围：当前活动播放列表的选中项，或显式曲目 handle 数组
 * 针对显式 handle 集合生成时宿主需逐条解析比对，在大规模集合或网络路径下开销较高，调用方应限制传入条数
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
  /** 构建当前菜单树的目标曲目凭据；若为 null 说明为空树，命令不可执行 */
  readonly target: ContextTarget | null;
  /** 宿主返回的目标曲目集合指纹，执行命令时原样回传校验；未提供时（如列表模式）宿主跳过指纹校验 */
  readonly targetKey?: string;
}

export const EMPTY_CONTEXT_TREE: ContextTree = { roots: [], target: null };
export const FAILED_CONTEXT_TREE: ContextTree = { ...EMPTY_CONTEXT_TREE, failed: true };

/** 将只读的目标配置浅拷贝为 SDK 所需的可变参数对象，防止外部只读数组被意外修改 */
function targetParams(target: ContextTarget): { mode: string; handles?: string[] } {
  return target.mode === 'handles' ? { mode: 'handles', handles: [...target.handles] } : target;
}

/**
 * 异步获取目标曲目的原生上下文菜单命令树
 * 显式区分加载失败与正常空树状态；可选传入 `locale` 指导宿主本地化标签，特征识别仍以原始英文标签为准
 */
export async function readContextTree(
  host: ContextMenuFace,
  target: ContextTarget,
  locale?: string,
): Promise<ContextTree> {
  // 不交给宿主命令的来源（在线曲目）不建树：属性、更多命令与宿主评分随之不出。
  // 标 loading: false 表示读完了、就是空，否则「更多命令」会一直显示读取状态
  if (target.mode === 'handles' && !batchAbilities(target.handles).hostCommands)
    return { ...EMPTY_CONTEXT_TREE, loading: false };
  const params = { ...targetParams(target), ...(locale ? { locale } : {}) };
  const answer = await settle(() => host.menu.getContextMenu(params));
  if (!answer || answer.success === false) return FAILED_CONTEXT_TREE;
  return {
    roots: answer.items,
    target,
    ...(answer.targetKey ? { targetKey: answer.targetKey } : {}),
  };
}

/**
 * 执行树里的一条命令，目标是生成这棵树时的那一份。空树、没有编号或已置灰的不发；
 * 宿主答失败或调用出错答 false。树带 `targetKey` 时同时回传节点的 `path`：曲目变了、编号指到别的命令、
 * 命令变灰或路径在树里不唯一，宿主都不执行，同样答 false
 */
export async function runContextCommand(
  host: ContextMenuFace,
  tree: ContextTree,
  node: MenuCommand,
): Promise<boolean> {
  const { target } = tree;
  if (!target || typeof node.commandId !== 'number' || !isEnabled(node)) return false;
  const id = node.commandId;
  // 两项要成对给，缺一项宿主按参数错误拒收
  const check =
    tree.targetKey && node.path ? { expectPath: node.path, expectTarget: tree.targetKey } : {};
  const answer = await settle(() =>
    host.menu.runContextCommandById(id, { ...targetParams(target), ...check }),
  );
  return !!answer && answer.success !== false;
}

/** 认命令用的标签：去掉助记符 `&`、尾部省略号与两端空白，ASCII 折小写 */
export function normalizeLabel(label: string): string {
  return label
    .replace(/&/g, '')
    .replace(/(?:\.\.\.|…)\s*$/, '')
    .trim()
    .toLowerCase();
}

/** 要认的命令标签，比对前都过 `normalizeLabel`：中文是汉化版取回的写法，英文按 fb2k 原文 */
const LABELS = {
  properties: ['properties', '属性'],
  sendToPlaylist: ['send to playlist', '发送到播放列表'],
};
const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export interface RatingCommands {
  /** 1–5 各档与树里对应的叶子 */
  readonly values: readonly { readonly value: number; readonly node: MenuCommand }[];
  /** 宿主的「未设置」一项，标签形如 `<…>`；没有就不提供清除 */
  readonly clear: MenuCommand | null;
  /** 宿主勾在哪一档：1–5，勾在「未设置」上是 0，哪档都没勾是 null。只照搬宿主的勾选 */
  readonly current: number | null;
}

export interface KnownCommands {
  readonly properties: MenuCommand | null;
  /** 宿主的「发送到播放列表…」对话框，行数太多不便自己列目标时用 */
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

/** 恰好一条才算认出；同一标签匹到几条就当没有，不猜 */
function only<T>(list: readonly T[]): T | null {
  return list.length === 1 ? (list[0] ?? null) : null;
}

/** 可用、带编号的才交出去 */
function usable(node: MenuCommand | null): MenuCommand | null {
  return node && isEnabled(node) && typeof node.commandId === 'number' ? node : null;
}

/**
 * 评分子菜单靠子项认，不靠它自己的标签：「等级」「Rating」随宿主语言变，1–5 不变
 * 恰有一个子菜单的命令子项覆盖这五个数字才算找到
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

/** 从树里认出属性、发送到对话框与评分三样；认不出的为 null，对应的菜单项置灰 */
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
 * 调用方据此像自绘的评分项那样先记下新值：宿主树要到下次打开才重读，期间勾选按记下的显示
 */
export function ratingValueOf(rating: RatingCommands | null, node: MenuCommand): number | null {
  if (!rating || typeof node.commandId !== 'number') return null;
  const entry = rating.values.find((candidate) => candidate.node.commandId === node.commandId);
  if (entry) return entry.value;
  return rating.clear?.commandId === node.commandId ? 0 : null;
}
