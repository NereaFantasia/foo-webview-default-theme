import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { settle } from '../../../host/hostCall.ts';
import { localeAtom } from '../../../i18n/locale.ts';
import {
  EMPTY_CONTEXT_TREE,
  FAILED_CONTEXT_TREE,
  readContextTree,
  type ContextTree,
} from '../../../host/contextMenu.ts';
import { trackPathOf } from '../../../host/libraryContract.ts';
import { readSendTargets, type SendTarget } from '../../../track/trackListActions.ts';
import type { FoldersTarget } from './foldersActions.ts';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';
import { ratingsKey } from '../../../track/trackRatings.ts';

export interface FoldersMenuData {
  readonly loading: boolean;
  readonly tracks: readonly LibraryTrack[] | null;
  readonly tree: ContextTree;
  readonly targets: readonly SendTarget[];
  readonly realDirectory: boolean;
  readonly retry?: () => void;
  readonly ratingStamp: number;
}
const EMPTY: FoldersMenuData = {
  loading: true,
  tracks: null,
  tree: EMPTY_CONTEXT_TREE,
  targets: [],
  realDirectory: false,
  ratingStamp: 0,
};
export function useFoldersMenu(target: FoldersTarget) {
  const folders = useService(foldersKey);
  const ratings = useService(ratingsKey);
  const locale = useAtomValueRawSync(localeAtom);
  const [state, setState] = useState(EMPTY);
  useEffect(() => {
    let disposed = false;
    const update = (change: Partial<FoldersMenuData>) => {
      if (!disposed) setState((previous) => ({ ...previous, ...change }));
    };
    setState(EMPTY);
    void readSendTargets(fb).then((targets) => update({ targets }));
    const node =
      target.nodes.length === 1 && (!target.tracks || target.nodeMenu)
        ? target.nodes[0]
        : undefined;
    if (node)
      void settle(() => fb.file.exists(node.absolutePath)).then((answer) => {
        update({
          realDirectory: answer?.success === true && answer.exists && answer.isDirectory === true,
        });
      });
    const ratingStamp = target.ratingStamp ?? (target.tracks ? 0 : ratings.stamp());
    void folders.actions.collect(target).then(async (tracks) => {
      if (disposed) return;
      update({ tracks, loading: false, ratingStamp });
      if (!tracks) return update({ tree: FAILED_CONTEXT_TREE });
      if (!tracks.length || tracks.length > 500)
        return update({ tree: { ...EMPTY_CONTEXT_TREE, loading: false } });
      let request = 0;
      const retry = async () => {
        if (disposed) return;
        const mine = ++request;
        update({ tree: EMPTY_CONTEXT_TREE });
        const tree = await readContextTree(
          fb,
          { mode: 'handles', handles: tracks.map(trackPathOf) },
          locale.base,
        );
        if (mine === request) update({ tree });
      };
      update({ retry: () => void retry() });
      await retry();
    });
    return () => {
      disposed = true;
    };
  }, [target, folders, ratings, locale.base]);
  return state;
}
