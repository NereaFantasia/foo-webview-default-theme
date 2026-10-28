import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { useService } from '../../kit/useService.ts';
import { queueKey } from './queueServices.ts';
import { upNextAtom } from './upNext.ts';
import { UP_NEXT_PAGE_SIZE, upNextNumberAt } from './upNextModel.ts';
import { useUpNextSource } from './useUpNextSource.ts';
import type { QueueList, QueueListRow } from './useQueueList.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useQueueRowHeight } from './queueRowHeight.ts';
import type { useQueueViewport } from './useQueueViewport.ts';
import styles from './QueueList.module.css';

interface QueueUpcomingProps {
  readonly list: QueueList;
  readonly viewport: ReturnType<typeof useQueueViewport>;
  rowOf(row: QueueListRow): ReactNode;
}

/** 只列这一轮还剩的曲目，到末尾就停；循环列表走到末尾后回到开头由播放顺序（播放栏）反映，这里不画 */
export function QueueUpcoming({ list, viewport, rowOf }: QueueUpcomingProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const viewControls = useViewControlStyles();
  const rowHeight = useQueueRowHeight();
  const services = useService(queueKey);
  const upNext = useAtomValueRawSync(upNextAtom);
  const source = useUpNextSource();
  const positions = new Set(viewport.visible.map((item) => list.queued.length + item.index + 1));
  const shownRows = list.upNext.filter((row) => positions.has(row.number));
  return (
    <>
      {upNext.total > 0 && (
        <section className={styles.section} data-queue-section="upnext">
          <div className={styles.head} data-lead>
            <span className={styles.label}>
              {t('queue.upNext')}
              <span className={styles.count}>
                {t(plural(upNext.total, 'queue.countOne', 'queue.count'), { count: upNext.total })}
              </span>
            </span>
            {source && (
              <button
                type="button"
                className={styles.source}
                aria-label={t('queue.from', { source: source.label })}
                title={t('queue.from', { source: source.label })}
                onClick={source.open}
              >
                {t('queue.from', { source: source.shortLabel })}
                <span aria-hidden> ›</span>
              </button>
            )}
          </div>
          <div
            ref={viewport.element}
            className={styles.list}
            role="listbox"
            aria-label={t('queue.upNextList')}
            aria-multiselectable
            style={{ height: viewport.height }}
            inert={upNext.refreshing}
            aria-busy={upNext.refreshing}
            data-queue-virtual-list
          >
            <div ref={viewport.viewport} className={styles.viewport} data-queue-viewport>
              <div ref={viewport.strip} className={styles.strip}>
                {viewport.visible.map((item) => {
                  const row = shownRows.find(
                    (entry) => entry.number === list.queued.length + item.index + 1,
                  );
                  const failed = upNext.failedPages.has(Math.floor(item.index / UP_NEXT_PAGE_SIZE));
                  return (
                    <div
                      key={row?.key ?? `pending:${upNext.version}:${item.index}`}
                      className={styles.virtualRow}
                      data-queue-slot={item.index}
                      style={{
                        height: rowHeight,
                        transform: `translateY(${item.start - viewport.margin}px)`,
                      }}
                    >
                      {row ? (
                        rowOf(row)
                      ) : (
                        <div
                          className={styles.placeholder}
                          role="option"
                          aria-disabled
                          aria-selected={false}
                          aria-label={t('queue.loadingRows')}
                        >
                          <span>{upNextNumberAt(upNext, item.index)}</span>
                          <span className={styles.placeholderCover} aria-hidden />
                          {failed ? (
                            <Button
                              className={viewControls.icon}
                              appearance="subtle"
                              size="small"
                              onClick={() =>
                                void services.upNext.readRange(item.index, item.index, true)
                              }
                            >
                              {t('queue.retryRows')}
                            </Button>
                          ) : (
                            <span className={styles.placeholderText} aria-hidden>
                              <span />
                              <span />
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
