import { useLayoutEffect, useMemo, type RefObject } from 'react';
import { useVirtualFold } from '../../../motion/useVirtualFold.ts';
import type { FolderRow } from './foldersModel.ts';
import type { FoldersTreeState } from './foldersTree.ts';

interface FoldersTreeMotionOptions {
  readonly layer: RefObject<HTMLDivElement | null>;
  readonly scroll: RefObject<HTMLDivElement | null>;
  readonly rows: readonly FolderRow[];
  readonly tree: Pick<FoldersTreeState, 'expanded' | 'children' | 'failed'>;
  /** 库换代或筛选词变了就换一个值，正在播的开合随之停下。 */
  readonly scope: string;
  readonly active: boolean;
  /** 每行的高，像素。 */
  readonly rowHeight: number;
}

/** 副本照原样画选中底色与子目录的展开箭头。 */
const KEEP = new Set(['aria-selected', 'aria-expanded']);

/**
 * 目录树单个父目录的开合：父行不动，子目录从它下面滑出、滑回，下方目录同步让位、补位。
 * 第一次展开的目录要等宿主读回子目录，读回后再播；读取失败或没有子目录时不播。
 */
export function useFoldersTreeMotion(options: FoldersTreeMotionOptions) {
  const { rows, tree, scope, active, rowHeight } = options;
  const index = useMemo(() => new Map(rows.map((row, at) => [row.node.key, at])), [rows]);
  // 宿主每次发布都会换一份行数组；只有行的顺序真的变了才算数据刷新。
  const version = useMemo(
    () => `${scope}\n${rows.map((row) => row.node.key).join('\n')}`,
    [scope, rows],
  );
  const fold = useVirtualFold({
    root: options.layer,
    scroller: options.scroll,
    enabled: true,
    keyAttribute: 'data-folder-row',
    markAttribute: 'data-folder-fold-ghost',
    keep: KEEP,
    floor: (root) => root,
    version,
    stateOf(key) {
      if (!active || !index.has(key)) return null;
      if (!tree.expanded.has(key)) return 'closed';
      return tree.children.has(key) || tree.failed.has(key) ? 'open' : 'loading';
    },
    spanOf(key) {
      const at = index.get(key) ?? rows.length;
      const level = rows[at]?.level ?? 0;
      let end = at + 1;
      while (end < rows.length && (rows[end]?.level ?? 0) > level) end++;
      const keys = rows.map((row) => row.node.key);
      return {
        body: new Set(keys.slice(at + 1, end)),
        below: new Set(keys.slice(end)),
        height: Math.max(0, end - at - 1) * rowHeight,
      };
    },
  });
  useLayoutEffect(() => {
    if (!active) fold.stop();
  }, [active, fold]);
  useLayoutEffect(() => fold.commit());
  return fold;
}
