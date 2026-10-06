import { Button } from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { pluralAtom } from '../../../i18n/plural.ts';
import { useRightCard } from '../rightCardContext.ts';
import { upNextAtom } from './upNext.ts';
import { UP_NEXT_PAGE_SIZE, upNextNumberAt } from './upNextModel.ts';
import { useUpNextSource } from './useUpNextSource.ts';
import type { QueueList, QueueListRow } from './useQueueList.ts';
import { type useQueueViewport, QUEUE_ROW_HEIGHT } from './useQueueViewport.ts';
import styles from './QueuePage.module.css';

interface QueueUpcomingProps {
  readonly list: QueueList;
  readonly viewport: ReturnType<typeof useQueueViewport>;
  readonly expanded: boolean;
  toggle(): void;
  rowOf(row: QueueListRow): ReactNode;
}

/** 下一轮的分界占一个虚拟槽；收起后行和键盘范围都停在本轮末尾。 */
export function QueueUpcoming({ list, viewport, expanded, toggle, rowOf }: QueueUpcomingProps) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const services = useRightCard();
  const upNext = useAtomValueRawSync(upNextAtom);
  const source = useUpNextSource();
  const positions = new Set(
    viewport.visible
      .filter((item) => !viewport.isRoundHeader(item.index))
      .map((item) => list.queued.length + viewport.offsetOf(item.index) + 1),
  );
  const shownRows = list.upNext.filter((row) => positions.has(row.number));
  return (
    <>
      {upNext.total > 0 && (
        <section className={styles.section} data-queue-section="upnext">
          <div className={styles.head}>
            <span className={styles.label}>
              {t('queue.upNext')}
              <span className={styles.count}>
                {t(plural(upNext.currentCount, 'queue.countOne', 'queue.count'), {
                  count: upNext.currentCount,
                })}
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
                {source.shortLabel}
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
                    (entry) =>
                      entry.number === list.queued.length + viewport.offsetOf(item.index) + 1,
                  );
                  const failed = upNext.failedPages.has(
                    Math.floor(viewport.offsetOf(item.index) / UP_NEXT_PAGE_SIZE),
                  );
                  return (
                    <div
                      key={
                        viewport.isRoundHeader(item.index)
                          ? 'next-round'
                          : (row?.key ?? `pending:${upNext.version}:${item.index}`)
                      }
                      className={styles.virtualRow}
                      data-queue-slot={item.index}
                      style={{
                        height: QUEUE_ROW_HEIGHT,
                        transform: `translateY(${item.start - viewport.margin}px)`,
                      }}
                    >
                      {viewport.isRoundHeader(item.index) ? (
                        <button
                          type="button"
                          className={styles.nextRound}
                          aria-expanded={expanded}
                          aria-label={t('queue.nextRound', {
                            count: upNext.total - upNext.currentCount,
                          })}
                          data-queue-next-round
                          onClick={toggle}
                        >
                          {expanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                          <span>{t('queue.nextRoundTitle')}</span>
                          <span className={styles.count}>
                            {t(
                              plural(
                                upNext.total - upNext.currentCount,
                                'queue.countOne',
                                'queue.count',
                              ),
                              {
                                count: upNext.total - upNext.currentCount,
                              },
                            )}
                          </span>
                        </button>
                      ) : row ? (
                        rowOf(row)
                      ) : (
                        <div
                          className={styles.placeholder}
                          role="option"
                          aria-disabled
                          aria-selected={false}
                          aria-label={t('queue.loadingRows')}
                        >
                          <span>{upNextNumberAt(upNext, viewport.offsetOf(item.index))}</span>
                          <span className={styles.placeholderCover} aria-hidden />
                          {failed ? (
                            <Button
                              appearance="subtle"
                              size="small"
                              onClick={() =>
                                void services.upNext.readRange(
                                  viewport.offsetOf(item.index),
                                  viewport.offsetOf(item.index),
                                  true,
                                )
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
