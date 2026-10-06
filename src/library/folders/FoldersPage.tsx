import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { PageProps } from '../../nav/places.ts';
import { PageEntryContext } from '../../nav/usePageSnapshot.ts';
import { historyAtom } from '../../nav/navHistory.ts';
import type { TablePoint } from '../../table/tableItems.ts';
import type { TableSort } from '../../table/TrackTableHeader.tsx';
import type { TrackTableHandle } from '../../table/TrackTable.tsx';
import { foldersNoticeAtom, type FoldersTarget } from './actions/foldersActions.ts';
import { FoldersMenu } from './actions/FoldersMenu.tsx';
import { FoldersTrashDialog } from './actions/FoldersTrashDialog.tsx';
import { foldersFocusAtom, foldersKey } from './foldersServices.ts';
import { foldersResultsAtom } from './detail/foldersResults.ts';
import { foldersPreviewAtom } from './detail/foldersPreview.ts';
import { FoldersDetail } from './detail/FoldersDetail.tsx';
import { useFoldersView } from './detail/useFoldersView.ts';
import { foldersTreeAtom } from './tree/foldersTree.ts';
import { foldersSubjects } from './tree/foldersModel.ts';
import type { FoldersTreeHandle } from './tree/FoldersTree.tsx';
import { FoldersNavigator } from './tree/FoldersNavigator.tsx';
import { FoldersHeader } from './FoldersHeader.tsx';
import { FoldersToolbar } from './detail/FoldersToolbar.tsx';
import { useFoldersSnapshot } from './useFoldersSnapshot.ts';
import { useLibrarySplit } from '../split-view/useLibrarySplit.ts';
import { LibrarySplitHandle } from '../split-view/LibrarySplitHandle.tsx';
import { LibraryDrawer } from '../split-view/LibraryDrawer.tsx';
import styles from './FoldersPage.module.css';
import { useService } from '../../kit/useService.ts';
import { AddFoldersAction } from '../AddFoldersAction.tsx';

interface OpenMenu {
  readonly target: FoldersTarget;
  readonly point: TablePoint;
  readonly isCurrent: () => boolean;
}
export function FoldersPage({ place }: PageProps) {
  const folders = useService(foldersKey);
  const store = useStore();
  const entry = useContext(PageEntryContext);
  const history = useAtomValueRawSync(historyAtom);
  const active = entry === null || entry === history.entry;
  const t = useAtomValueRawSync(translateAtom);
  const catalog = useAtomValueRawSync(foldersTreeAtom);
  const notice = useAtomValueRawSync(foldersNoticeAtom);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [sort, setSort] = useState<TableSort | null>(null);
  const tree = useRef<HTMLDivElement>(null);
  const treeHandle = useRef<FoldersTreeHandle>(null);
  const table = useRef<TrackTableHandle>(null);
  const content = useRef<HTMLDivElement>(null);
  const split = useLibrarySplit('folders', 252);
  const model = useFoldersView(sort);
  useAtomValueRawSync(model.selection.state);
  function showMenu(target: FoldersTarget, point: TablePoint) {
    const generation = store.get(foldersTreeAtom).generation;
    const subject = store.get(foldersFocusAtom);
    const selected = store.get(model.selection.state);
    const order = store
      .get(foldersResultsAtom)
      .tracks.map((track) => track.handle)
      .join('\n');
    setMenu({
      target,
      point,
      isCurrent: () => {
        const state = store.get(foldersTreeAtom);
        return (
          state.status === 'ready' &&
          generation === state.generation &&
          subject === store.get(foldersFocusAtom) &&
          (!target.tracks ||
            (order ===
              store
                .get(foldersResultsAtom)
                .tracks.map((track) => track.handle)
                .join('\n') &&
              (!target.trackMenu || selected === store.get(model.selection.state))))
        );
      },
    });
  }
  const hasSnapshot = useFoldersSnapshot(
    tree,
    treeHandle,
    table,
    content,
    sort,
    setSort,
    active,
    model,
  );
  // 离场层保留使用权到卸载，目录之间交接时不清空共享树和预览。
  useEffect(() => folders.want(), [folders]);
  useEffect(() => {
    if (!active || !place.subject || hasSnapshot) return;
    const shown = store.get(foldersPreviewAtom);
    if (foldersSubjects(shown.nodes) !== place.subject) void folders.open(place.subject);
  }, [folders, place.subject, active, hasSnapshot, store]);
  useEffect(() => {
    if (catalog.status === 'loading' || !active || !split.compact) {
      setMenu(null);
      setDirectoryOpen(false);
    }
  }, [catalog.status, active, split.compact]);
  const navigator = (
    <FoldersNavigator
      active={active}
      scroll={tree}
      handle={treeHandle}
      onMenu={(nodes, point) => showMenu({ nodes }, point)}
      onPlay={(node) => void folders.actions.run({ nodes: [node] }, 'play')}
    />
  );
  return (
    <section className={styles.root} aria-label={t('folders.title')} data-page="folders">
      <FoldersHeader model={model} onMenu={showMenu} />
      <FoldersToolbar
        model={model}
        compact={split.compact}
        onDirectory={() => setDirectoryOpen(true)}
      />
      {notice && (
        <div role="alert" className={styles.notice}>
          {t(`folders.${notice}`)}
          <Button size="small" onClick={folders.actions.dismiss}>
            {t('folders.dismiss')}
          </Button>
        </div>
      )}
      {catalog.status === 'failed' && (
        <div role="alert" className={styles.notice}>
          {t('folders.failed')}
          <Button onClick={() => void folders.tree.retry()}>{t('folders.retry')}</Button>
        </div>
      )}
      {catalog.status === 'ready' && !catalog.enabled && (
        <>
          <p className={styles.notice}>{t('folders.disabled')}</p>
          <AddFoldersAction />
        </>
      )}
      {catalog.skipped > 0 && (
        <p className={styles.notice}>{t('folders.skipped', { count: catalog.skipped })}</p>
      )}
      <div className={styles.body} ref={split.measure}>
        {!split.compact && (
          <>
            <aside className={styles.browser} style={{ flexBasis: split.size }}>
              {navigator}
            </aside>
            <LibrarySplitHandle split={split} label={t('folders.split')} />
          </>
        )}
        <FoldersDetail
          model={model}
          handle={table}
          scroll={content}
          sort={sort}
          onSort={setSort}
          onMenu={showMenu}
        />
      </div>
      {split.compact && (
        <LibraryDrawer
          open={directoryOpen && active}
          title={t('folders.directory')}
          closeLabel={t('folders.closeDirectory')}
          onOpenChange={setDirectoryOpen}
        >
          {navigator}
        </LibraryDrawer>
      )}
      {menu && (
        <FoldersMenu
          target={menu.target}
          point={menu.point}
          isCurrent={menu.isCurrent}
          onClose={() => setMenu(null)}
        />
      )}
      {active && <FoldersTrashDialog />}
    </section>
  );
}
