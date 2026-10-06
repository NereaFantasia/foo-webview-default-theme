import { Link } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import styles from './QueueNotice.module.css';

/** 提示停留多久，毫秒；带「撤销」的那条多留一会儿。 */
const FAILED_MS = 4000;
const CLEARED_MS = 6000;

export interface QueueNoticeProps {
  /** 刚清空了几首；没有为 null。 */
  readonly cleared: number | null;
  /** 命令失败的次数，每多一次出一条。 */
  readonly failed: number;
  onUndo(): void;
  onDismissCleared(): void;
}

/**
 * 队列页底部的一条提示：清空之后写清了几首、带「撤销」，到时收起；命令失败写一句请再试。两条同时来时
 * 后来的那条为准。读屏随出随念。
 */
export function QueueNotice({ cleared, failed, onUndo, onDismissCleared }: QueueNoticeProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const [failure, setFailure] = useState(false);
  const [seen, setSeen] = useState({ failed, cleared });
  if (seen.failed !== failed || seen.cleared !== cleared) {
    setSeen({ failed, cleared });
    if (seen.failed !== failed) setFailure(true);
    else if (cleared !== null) setFailure(false);
  }
  const latest = useRef(onDismissCleared);
  useLayoutEffect(() => {
    latest.current = onDismissCleared;
  });

  useEffect(() => {
    if (!failure) return;
    const timer = setTimeout(() => setFailure(false), FAILED_MS);
    return () => clearTimeout(timer);
  }, [failure, failed]);

  useEffect(() => {
    if (cleared === null) return;
    const timer = setTimeout(() => latest.current(), CLEARED_MS);
    return () => clearTimeout(timer);
  }, [cleared]);

  let content = null;
  if (failure) content = <span>{t('queue.commandFailed')}</span>;
  else if (cleared !== null) {
    content = (
      <>
        <span>{t(plural(cleared, 'queue.clearedOne', 'queue.cleared'), { count: cleared })}</span>
        <Link
          onClick={() => {
            onDismissCleared();
            onUndo();
          }}
        >
          {t('queue.undo')}
        </Link>
      </>
    );
  }
  return (
    <div className={styles.root} role="status" data-queue-notice={content ? '' : undefined}>
      {content && <div className={styles.bar}>{content}</div>}
    </div>
  );
}
