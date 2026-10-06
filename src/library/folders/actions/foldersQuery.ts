import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { normalizeHostPath } from '../../../host/hostPath.ts';
import { settle } from '../../../host/hostCall.ts';
import type { FolderNode } from '../tree/foldersModel.ts';

const SORT = '$directory_path(%path%)|%discnumber%|%tracknumber%|%title%';
function prefix(path: string): string | null {
  const normalized = normalizeHostPath(path).replace(/\\+$/, '');
  return /^(?:[a-z]:\\|\\\\)/.test(normalized) && !/["*?\r\n]/.test(normalized)
    ? `${normalized}\\`
    : null;
}
/** 嵌套库根独立归属；目录查询必须显式排除，不能把父根当作磁盘的递归目录。 */
export function foldersQuery(
  nodes: readonly FolderNode[],
  roots: readonly FolderNode[],
): string | null {
  const clauses: string[] = [];
  for (const node of nodes) {
    const path = prefix(node.absolutePath);
    if (!path) return null;
    let clause = `%path% HAS "${path}"`;
    for (const root of roots) {
      if (root.rootId === node.rootId) continue;
      const child = prefix(root.absolutePath);
      if (!child) return null;
      if (child.startsWith(path)) clause += ` AND NOT (%path% HAS "${child}")`;
    }
    clauses.push(`(${clause})`);
  }
  return clauses.length ? clauses.join(' OR ') : null;
}

/** 先将查询成员与目录树的完整句柄逐一核对；便携路径或归档映射不一致时不创建自动列表。 */
export async function createFoldersAutoplaylist(
  host: Pick<typeof fb, 'library' | 'playlist'>,
  query: string,
  tracks: readonly LibraryTrack[],
  name: string,
  current: () => boolean,
): Promise<string | null> {
  if (!current() || tracks.length === 0) return null;
  const answer = await settle(() => host.library.query(query, SORT, tracks.length + 1, ['handle']));
  if (
    !current() ||
    !answer ||
    answer.success === false ||
    answer.total !== tracks.length ||
    answer.tracks.length !== tracks.length
  )
    return null;
  const expected = new Set(tracks.map((track) => track.handle));
  const actual = new Set(answer.tracks.map((track) => track.handle));
  if (
    actual.size !== expected.size ||
    ![...actual].every((handle) => handle && expected.has(handle))
  )
    return null;
  const created = await settle(() => host.playlist.createAutoplaylist(name, query, SORT, false));
  if (!created || created.success === false) return null;
  if (!current()) {
    await settle(() => host.playlist.remove(created.guid));
    return null;
  }
  const active = await settle(() => host.playlist.setActive(created.guid));
  return current() && active?.success === true ? created.guid : null;
}
