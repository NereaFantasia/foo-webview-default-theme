import { Button, Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import { useViewControlStyles } from '../../../theme/controlStyles.ts';
import styles from './OnlineMore.module.css';

/**
 * 在线分页列表的触底加载触发器，供搜索结果与在线播放列表共用。
 * 支持滚动触底自动加载与异常中断重试；`more` 为假时隐藏组件，`auto` 为假时禁用自动触发并仅展示手动加载按钮
 */
export function OnlineMore({
  more,
  loadingMore,
  moreFailed,
  scroller,
  auto = true,
  onMore,
}: {
  readonly more: boolean;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  readonly scroller: HTMLElement | null;
  readonly auto?: boolean;
  onMore(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  useLayoutEffect(() => {
    latest.current = onMore;
  });
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !scroller || !more || loadingMore || moreFailed || !auto) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { root: scroller, rootMargin: '0px 0px 280px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [scroller, more, loadingMore, moreFailed, auto]);
  if (!more) return null;
  return (
    <div ref={sentinel} className={styles.more} data-online-more>
      {loadingMore ? (
        <Spinner size="tiny" aria-label={t('album.loading')} />
      ) : (
        <Button className={viewControls.field} onClick={onMore}>
          {t(moreFailed ? 'album.retry' : 'search.more')}
        </Button>
      )}
    </div>
  );
}
