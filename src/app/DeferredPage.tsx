import { Body1, Button, Spinner } from '@fluentui/react-components';
import { ArrowClockwise20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  lazy,
  Suspense,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { historyAtom, historyKey } from '../nav/navHistory.ts';
import { START_PLACE, type PageProps } from '../nav/places.ts';
import { useCommand } from '../nav/useCommand.ts';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';
import styles from './DeferredPage.module.css';

function PageStatus({ failed = false }: { readonly failed?: boolean }) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const history = useService(historyKey);
  const entry = useContext(PageEntryContext);
  useCommand({
    id: 'page.loading.leave',
    layer: 'overlay',
    keys: [{ key: 'Escape' }],
    enabled: () => store.get(historyAtom).entry === entry,
    run: () => {
      if (!history.back()) history.navigate(START_PLACE);
    },
  });
  return (
    <div
      className={styles.root}
      data-page-loading={failed ? 'failed' : 'pending'}
      role={failed ? 'alert' : undefined}
    >
      {failed ? (
        <>
          <Body1>{t('page.loadFailed')}</Body1>
          <Button icon={<ArrowClockwise20Regular />} onClick={() => location.reload()}>
            {t('page.reload')}
          </Button>
        </>
      ) : (
        <Spinner size="small" label={t('page.loading')} />
      )}
    </div>
  );
}

function PageLoadFailure() {
  return <PageStatus failed />;
}

function PageReady({
  shown,
  children,
}: {
  readonly shown: RefObject<boolean>;
  readonly children: ReactNode;
}) {
  useLayoutEffect(() => {
    shown.current = true;
  }, [shown]);
  return children;
}

/** 页面模块首次进入时加载；导入失败留在当前页面，由用户重新加载主题恢复。 */
export function deferPage(load: () => Promise<ComponentType<PageProps>>): ComponentType<PageProps> {
  const Page = lazy(() =>
    load()
      .then((component) => ({ default: component }))
      .catch(() => ({ default: PageLoadFailure })),
  );
  return function DeferredPage(props: PageProps) {
    const entry = useContext(PageEntryContext);
    const current = useAtomValueRawSync(historyAtom).entry === entry;
    const shown = useRef(false);
    // 已显示的页面保留退场；尚未显示就离开时，不让迟到的 Portal 或页面副作用重新挂载。
    if (!current && !shown.current) return null;
    return (
      <Suspense fallback={<PageStatus />}>
        <PageReady shown={shown}>
          <Page {...props} />
        </PageReady>
      </Suspense>
    );
  };
}
