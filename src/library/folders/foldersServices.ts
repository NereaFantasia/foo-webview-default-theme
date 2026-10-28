import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { historyAtom, type NavHistoryService } from '../../nav/navHistory.ts';
import type { Store } from '../../kit/store.ts';
import {
  startFoldersActions,
  type FoldersActionsDeps,
  type FoldersActionsFace,
  type FoldersActionsService,
  type FoldersTarget,
} from './actions/foldersActions.ts';
import {
  startFoldersPreview,
  foldersPreviewAtom,
  type FoldersPreviewService,
} from './detail/foldersPreview.ts';
import { startFoldersFilter, type FoldersFilterService } from './tree/foldersFilter.ts';
import {
  foldersAddress,
  foldersHitAddress,
  foldersRoot,
  foldersSubject,
  foldersSubjects,
  foldersSelection,
  type FolderNode,
} from './tree/foldersModel.ts';
import { startFoldersPrefs, type FoldersPrefsService } from './foldersPrefs.ts';
import {
  startFoldersTrash,
  type FoldersTrashFace,
  type FoldersTrashService,
} from './actions/foldersTrash.ts';
import { startFoldersResults, type FoldersResultsService } from './detail/foldersResults.ts';
import { startFoldersCovers, type FoldersCoversService } from './detail/foldersCovers.ts';
import {
  startFoldersTree,
  foldersTreeAtom,
  type FoldersHost,
  type FoldersTreeService,
} from './tree/foldersTree.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import { settle } from '../../host/hostCall.ts';

const focusAtom = atom<string | null>(null);
export const foldersFocusAtom: Atom<string | null> = atom((get) => get(focusAtom));
export interface FoldersDeps extends Omit<FoldersActionsDeps, 'roots'> {
  readonly history: Pick<NavHistoryService, 'registerSubject' | 'subjectsChanged' | 'navigate'>;
  stamp(): number;
}
export interface FoldersServices {
  readonly tree: FoldersTreeService;
  readonly preview: FoldersPreviewService;
  readonly filter: FoldersFilterService;
  readonly actions: FoldersActionsService;
  readonly prefs: FoldersPrefsService;
  readonly results: FoldersResultsService;
  readonly covers: FoldersCoversService;
  readonly trash: FoldersTrashService;
  want(): () => void;
  select(node: FolderNode, delay?: number): void;
  selectMany(nodes: readonly FolderNode[], delay?: number): void;
  open(subject: string, reveal?: boolean): Promise<boolean | null>;
  visit(subject: string): Promise<boolean | null>;
  /**
   * 解析指定文件所在目录的页面主体标识；位于媒体库根目录下返回主体键，非库路径返回 null，库根未就绪返回 undefined；
   * 仅查询不执行页面跳转，跳转由调用方按需执行
   */
  locateFile(absolutePath: string): Promise<string | null | undefined>;
  /** 导航进入文件夹页目标目录 */
  enter(subject: string): void;
  /** 在系统资源管理器中定位并高亮显示目标文件 */
  showInExplorer(absolutePath: string): Promise<boolean>;
  /** 打开文件夹页并应用视频筛选模式（若路径位于库根下则定位至其所在目录，否则还原上次浏览位置） */
  browseVideo(absolutePath: string | null): Promise<void>;
  /** 播放视频文件，待宿主确认起播成功后导航至视频页面（失败保留原状并通过通知提示） */
  playAndWatch(target: FoldersTarget): Promise<void>;
  dispose(): void;
}
export function startFolders(
  store: Store,
  deps: FoldersDeps,
  host: FoldersHost & FoldersActionsFace & FoldersTrashFace & Pick<typeof fb, 'artwork'> = fb,
): FoldersServices {
  store.set(focusAtom, null);
  const tree = startFoldersTree(store, host);
  const preview = startFoldersPreview(store, deps.stamp, host);
  const prefs = startFoldersPrefs(store);
  const results = startFoldersResults(store, host);
  const covers = startFoldersCovers(store, host);
  const trash = startFoldersTrash(store, host);
  const filter = startFoldersFilter(store, tree, host);
  const actions = startFoldersActions(
    store,
    {
      ...deps,
      roots: () => {
        const state = store.get(foldersTreeAtom);
        return state.roots.flatMap((key) => state.nodes.get(key) ?? []);
      },
    },
    host,
  );
  let disposed = false;
  let active = 0;
  let serial = 0;
  let generation = 0;
  let wasLoading = false;
  function select(node: FolderNode, delay = 0) {
    selectMany([node], delay);
  }
  function selectMany(nodes: readonly FolderNode[], delay = 0) {
    if (disposed || !active) return;
    const shown = store.get(foldersPreviewAtom);
    if (foldersSubjects(shown.nodes) === foldersSubjects(nodes) && shown.status !== 'failed')
      return;
    serial += 1;
    store.set(focusAtom, nodes.length ? foldersSubjects(nodes) : null);
    preview.selectMany(nodes, delay);
    deps.history.subjectsChanged();
  }
  async function open(subject: string, reveal = true) {
    const mine = ++serial;
    const nodes: FolderNode[] = [];
    for (const key of foldersSelection(subject)) {
      const found = await tree.locate(key);
      if (disposed || !active || mine !== serial) return null;
      if (!found) {
        store.set(focusAtom, null);
        preview.select(null);
        return false;
      }
      nodes.push(found);
    }
    const node = nodes[0];
    if (disposed || !active || mine !== serial) return null;
    if (!node) {
      store.set(focusAtom, null);
      preview.select(null);
      return false;
    }
    if (reveal) {
      const expanded = new Set(store.get(foldersTreeAtom).expanded);
      for (const selected of nodes) {
        let parent = selected.parent;
        while (parent) {
          expanded.add(parent);
          parent = store.get(foldersTreeAtom).nodes.get(parent)?.parent ?? null;
        }
      }
      await tree.restore(expanded);
    }
    if (disposed || !active || mine !== serial) return null;
    selectMany(nodes);
    return true;
  }
  // 文件夹页没挂载时目录树不在读，库根直接问宿主；去的是带主体的地点，页面挂载后自己定位；
  // 文件不在任何库根下答 null，读不到库根答 undefined
  async function directoryOf(absolutePath: string): Promise<string | null | undefined> {
    const answer = await settle(() => host.library.getRoots());
    if (disposed || !answer || answer.success === false) return undefined;
    const address = foldersHitAddress(absolutePath, answer.roots.map(foldersRoot));
    return address ? foldersSubject(address) : null;
  }
  const offSubject = deps.history.registerSubject('folders', {
    current: () => store.get(focusAtom),
    enter(subject) {
      serial += 1;
      store.set(focusAtom, subject);
      preview.select(null);
    },
    exists(subject) {
      const state = store.get(foldersTreeAtom);
      const keys = foldersSelection(subject);
      return (
        keys.length > 0 &&
        keys.every((key) => {
          const address = foldersAddress(key);
          return (
            !!address &&
            (state.status !== 'ready' ||
              state.roots.includes(foldersSubject({ ...address, pathId: '' })))
          );
        })
      );
    },
    replaceMissing: true,
  });
  const offTree = store.sub(foldersTreeAtom, () => {
    const state = store.get(foldersTreeAtom);
    if (state.status === 'loading' && !wasLoading) {
      wasLoading = true;
      preview.select(null);
      actions.cancel();
    }
    if (state.status !== 'ready' || generation === state.generation) return;
    wasLoading = false;
    generation = state.generation;
    const key = store.get(focusAtom);
    if (key && active) void open(key, false);
    deps.history.subjectsChanged();
  });
  return {
    tree,
    preview,
    filter,
    actions,
    prefs,
    results,
    covers,
    trash,
    select,
    selectMany,
    open,
    visit(subject) {
      if (disposed || !active) return Promise.resolve(null);
      // 离开快照必须先记录旧主体，随后再切换预览
      const current = store.get(historyAtom).place;
      if (current.id !== 'folders' || current.subject !== undefined)
        deps.history.navigate({ id: 'folders', subject });
      store.set(focusAtom, subject);
      return open(subject);
    },
    locateFile: directoryOf,
    enter(subject) {
      if (!disposed) deps.history.navigate({ id: 'folders', subject });
    },
    async showInExplorer(absolutePath) {
      const shown = await settle(() => host.shell.showInExplorer(absolutePath));
      return shown?.success === true;
    },
    async browseVideo(absolutePath) {
      results.setMedia('video');
      const subject = absolutePath === null ? null : await directoryOf(absolutePath);
      if (disposed) return;
      deps.history.navigate(subject ? { id: 'folders', subject } : { id: 'folders' });
    },
    async playAndWatch(target) {
      if (await actions.run(target, 'play')) deps.history.navigate({ id: 'video' }, 'drill');
    },
    want() {
      active += 1;
      const release = tree.want();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        if (active === 0) {
          serial += 1;
          filter.suspend();
          actions.cancel();
          preview.select(null);
        }
        release();
      };
    },
    dispose() {
      disposed = true;
      serial += 1;
      offTree();
      offSubject();
      actions.dispose();
      trash.dispose();
      results.dispose();
      covers.dispose();
      filter.dispose();
      preview.dispose();
      tree.dispose();
    },
  };
}

export const foldersKey = serviceKey<FoldersServices>('folders');
