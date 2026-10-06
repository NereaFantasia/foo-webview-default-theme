import type { LibraryTrack } from 'foo-webview-sdk';
import { normalizeHostPath } from '../../../host/hostPath.ts';
import type { TableItem } from '../../../table/tableItems.ts';
import type { TableSort } from '../../../table/TrackTableHeader.tsx';
import { foldersSubject, type FolderNode } from '../tree/foldersModel.ts';
import { foldersSort } from './foldersSort.ts';

export interface FolderGroup {
  readonly node: FolderNode;
  readonly direct: readonly LibraryTrack[];
  readonly tracks: readonly LibraryTrack[];
  readonly children: readonly FolderGroup[];
}
interface Branch {
  node: FolderNode;
  direct: LibraryTrack[];
  children: Map<string, Branch>;
}
export interface FoldersStructure {
  readonly groups: readonly FolderGroup[];
  readonly tracks: readonly LibraryTrack[];
}

/** 以宿主绝对路径分层；句柄去重保留同一文件的不同 subsong。 */
export function foldersStructure(
  nodes: readonly FolderNode[],
  tracks: readonly LibraryTrack[],
  sort: TableSort | null,
): FoldersStructure {
  const roots = nodes.filter(
    (node, index) =>
      !nodes.some(
        (other, at) =>
          at !== index &&
          other.rootId === node.rootId &&
          (other.key === node.key
            ? at < index
            : normalizeHostPath(node.absolutePath).startsWith(
                `${normalizeHostPath(other.absolutePath).replace(/\\+$/, '')}\\`,
              )),
      ),
  );
  const branches: Branch[] = roots.map((node) => ({ node, direct: [], children: new Map() }));
  const closestFirst = [...branches].sort(
    (a, b) => b.node.absolutePath.length - a.node.absolutePath.length,
  );
  for (const track of new Map(tracks.map((entry) => [entry.handle, entry])).values()) {
    const path = normalizeHostPath(track.absolutePath);
    const root = closestFirst.find(({ node }) =>
      path.startsWith(`${normalizeHostPath(node.absolutePath).replace(/\\+$/, '')}\\`),
    );
    if (!root) continue;
    const base = root.node.absolutePath.replace(/[\\/]+$/, '');
    const parts = track.absolutePath
      .replace(/\//g, '\\')
      .slice(base.length + 1)
      .split('\\');
    parts.pop();
    let branch = root;
    for (const name of parts) {
      const key = name.toLocaleLowerCase();
      let next = branch.children.get(key);
      if (!next) {
        const pathId = [branch.node.pathId, name].filter(Boolean).join('/');
        const node: FolderNode = {
          ...branch.node,
          pathId,
          key: foldersSubject({ rootId: branch.node.rootId, pathId }),
          name,
          absolutePath: `${branch.node.absolutePath}\\${name}`,
          parent: branch.node.key,
          count: 0,
          hasChildren: false,
        };
        next = { node, direct: [], children: new Map() };
        branch.children.set(key, next);
      }
      branch = next;
    }
    branch.direct.push(track);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function finish(branch: Branch): FolderGroup {
    const children = [...branch.children.values()]
      .sort((a, b) => collator.compare(a.node.name, b.node.name))
      .map(finish);
    const direct = foldersSort(branch.direct, sort);
    const all = [...direct, ...children.flatMap((child) => child.tracks)];
    return {
      node: { ...branch.node, count: all.length, hasChildren: children.length > 0 },
      direct,
      children,
      tracks: all,
    };
  }
  const groups = branches.map(finish);
  return { groups, tracks: groups.flatMap((group) => group.tracks) };
}

export interface FoldersGroupData {
  readonly group: FolderGroup;
  readonly own: boolean;
}
export function foldersItems(
  structure: FoldersStructure,
  collapsed: ReadonlySet<string>,
  coverWidth: number,
  rowHeight: number,
  covers = false,
): readonly TableItem<FoldersGroupData>[] {
  const items: TableItem<FoldersGroupData>[] = [];
  const orders = new Map(structure.tracks.map((track, index) => [track.handle, index]));
  function rows(group: FolderGroup) {
    for (const track of group.direct)
      items.push({ kind: 'row', key: track.handle, order: orders.get(track.handle) ?? 0, track });
    if (group.direct.length && coverWidth > 0) {
      const missing = Math.max(0, Math.ceil(coverWidth / rowHeight) - group.direct.length);
      for (let i = 0; i < missing; i++)
        items.push({ kind: 'filler', key: `${group.node.key}:space:${i}` });
    }
  }
  function visit(group: FolderGroup, level: number, own = false) {
    if (!group.tracks.length) return;
    const key = `${group.node.key}${own ? ':own' : ''}`;
    items.push({ kind: 'group', key, level, collapsed: collapsed.has(key), data: { group, own } });
    if (collapsed.has(key)) return;
    rows(group);
    if (!own) for (const child of group.children) visit(child, level + 1);
  }
  if (structure.groups.length === 1) {
    const root = structure.groups[0];
    if (root) {
      if (root.children.length && root.direct.length) visit(root, 0, true);
      else if (!root.children.length) {
        if (coverWidth > 0) visit(root, 0);
        else rows(root);
      }
      if (!covers) for (const child of root.children) visit(child, 0);
    }
  } else if (!covers) for (const root of structure.groups) visit(root, 0);
  return items;
}
