import type { LibraryRootInfo, LibraryDirectoryNodeInfo } from 'foo-webview-sdk';
import { normalizeHostPath } from '../../../host/hostPath.ts';
import { PLAY_LIMIT } from '../../../playback/libraryView.ts';

/** 一次预览、播放的曲目上限，同媒体库各处起播的上限；筛选也只要这么多条命中。提示文案里写着这个数。 */
export const FOLDERS_LIMIT = PLAY_LIMIT;
export interface FolderAddress {
  readonly rootId: string;
  readonly pathId: string;
}
export interface FolderNode extends FolderAddress {
  readonly key: string;
  readonly name: string;
  readonly absolutePath: string;
  readonly count: number;
  readonly parent: string | null;
  readonly hasChildren: boolean;
}
export interface FolderRow {
  readonly node: FolderNode;
  readonly level: number;
}
export function foldersSubject(address: FolderAddress): string {
  return JSON.stringify([address.rootId, address.pathId]);
}
export function foldersSubjects(nodes: readonly FolderNode[]): string {
  return nodes.length === 1
    ? (nodes[0]?.key ?? '')
    : `folders:${JSON.stringify(nodes.map((node) => node.key))}`;
}
export function foldersSelection(subject: string): readonly string[] {
  if (foldersAddress(subject)) return [subject];
  try {
    const value: unknown = JSON.parse(subject.startsWith('folders:') ? subject.slice(8) : 'null');
    return Array.isArray(value) &&
      value.every((key: unknown) => typeof key === 'string' && foldersAddress(key))
      ? value.filter((key: unknown): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}
export function foldersAddress(subject: string): FolderAddress | null {
  try {
    const value: unknown = JSON.parse(subject);
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [rootId, pathId]: unknown[] = value;
    return typeof rootId === 'string' && rootId !== '' && typeof pathId === 'string'
      ? { rootId, pathId }
      : null;
  } catch {
    return null;
  }
}
export function foldersRoot(root: LibraryRootInfo): FolderNode {
  const address = { rootId: root.id, pathId: '' };
  return {
    ...address,
    key: foldersSubject(address),
    name: root.displayName,
    absolutePath: root.absolutePath,
    count: root.trackCount,
    parent: null,
    hasChildren: true,
  };
}
export function foldersDirectory(node: LibraryDirectoryNodeInfo): FolderNode {
  return {
    rootId: node.rootId,
    pathId: node.pathId,
    key: foldersSubject(node),
    name: node.displayName,
    absolutePath: node.absolutePath,
    count: node.trackCount,
    parent: foldersSubject({ rootId: node.rootId, pathId: node.parentPathId }),
    hasChildren: node.hasChildren,
  };
}
export function foldersVisible(
  roots: readonly string[],
  nodes: ReadonlyMap<string, FolderNode>,
  children: ReadonlyMap<string, readonly string[]>,
  expanded: ReadonlySet<string>,
  allowed: ReadonlySet<string> | null = null,
): FolderRow[] {
  const rows: FolderRow[] = [];
  const visit = (keys: readonly string[], level: number) => {
    for (const key of keys) {
      const node = nodes.get(key);
      if (!node || (allowed && !allowed.has(key))) continue;
      rows.push({ node, level });
      if (expanded.has(key)) visit(children.get(key) ?? [], level + 1);
    }
  };
  visit(roots, 1);
  return rows;
}

/** 只用宿主给出的绝对路径；无法归根的归档路径交给调用方提示，不能猜一个目录。 */
export function foldersHitAddress(
  absolutePath: string,
  roots: readonly FolderNode[],
): FolderAddress | null {
  const path = normalizeHostPath(absolutePath);
  const root = [...roots]
    .sort((a, b) => b.absolutePath.length - a.absolutePath.length)
    .find((entry) =>
      path.startsWith(`${normalizeHostPath(entry.absolutePath).replace(/\\+$/, '')}\\`),
    );
  if (!root) return null;
  const base = normalizeHostPath(root.absolutePath).replace(/\\+$/, '');
  const relative = path.slice(base.length + 1);
  const end = relative.lastIndexOf('\\');
  return { rootId: root.rootId, pathId: end < 0 ? '' : relative.slice(0, end).replace(/\\/g, '/') };
}
