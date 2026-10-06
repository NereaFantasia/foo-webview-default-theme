import { fb } from 'foo-webview-sdk/bridge';
import { settle } from '../../../host/hostCall.ts';
import {
  foldersAddress,
  foldersDirectory,
  foldersSubject,
  type FolderNode,
} from './foldersModel.ts';

export interface FoldersTreeFace {
  library: Pick<typeof fb.library, 'getRoots' | 'browseTree'>;
}

/** 每次库索引换代创建一份；过期请求只可写它自己已被丢弃的缓存。 */
export function createFoldersCache(
  host: FoldersTreeFace,
  current: () => boolean,
  changed: () => void,
) {
  const nodes = new Map<string, FolderNode>();
  const children = new Map<string, readonly string[]>();
  const pending = new Map<string, Promise<boolean>>();
  const failed = new Set<string>();
  async function fetch(key: string): Promise<boolean> {
    const node = nodes.get(key);
    if (!node || !current()) return false;
    failed.delete(key);
    const answer = await settle(() =>
      host.library.browseTree({ rootId: node.rootId, pathId: node.pathId }),
    );
    if (!current()) return false;
    if (!answer || answer.success === false) failed.add(key);
    else {
      const rows = answer.directories.map(foldersDirectory);
      for (const row of rows) nodes.set(row.key, row);
      children.set(
        key,
        rows.map((row) => row.key),
      );
    }
    return !failed.has(key);
  }
  async function load(key: string): Promise<boolean> {
    if (children.has(key)) return true;
    const active = pending.get(key);
    if (active) return active;
    const promise = fetch(key);
    pending.set(key, promise);
    changed();
    try {
      return await promise;
    } finally {
      pending.delete(key);
      if (current()) changed();
    }
  }
  async function locate(subject: string): Promise<FolderNode | null> {
    const address = foldersAddress(subject);
    if (!address || !current()) return null;
    let key = foldersSubject({ rootId: address.rootId, pathId: '' });
    let node = nodes.get(key);
    if (!node) return null;
    const segments = address.pathId.split('/').filter(Boolean);
    let path = '';
    for (const segment of segments) {
      if (!(await load(key)) || !current()) return null;
      path = path ? `${path}/${segment}` : segment;
      node = (children.get(key) ?? [])
        .map((child) => nodes.get(child))
        .find((child) => child?.pathId.toLowerCase() === path.toLowerCase());
      if (!node) return null;
      key = node.key;
    }
    return node;
  }
  return { nodes, children, pending, failed, load, locate };
}
