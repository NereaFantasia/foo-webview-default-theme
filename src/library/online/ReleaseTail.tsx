import { Button, Spinner, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ArrowClockwise16Regular, ChevronDoubleDown16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import type { ArtistReleases } from './useArtistReleases.ts';
import styles from './ReleaseTail.module.css';

/** 胶囊按钮样式微调：规范 32px 高度下的图标尺寸为 16px、次要文本色及常规字重，保持视觉平衡 */
const usePillStyles = makeStyles({
  pill: {
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
    fontWeight: tokens.fontWeightRegular,
    '& .fui-Button__icon': { width: '16px', height: '16px', fontSize: '16px' },
    '@media (forced-colors: none)': {
      '&:not(:disabled, [aria-disabled="true"]) .fui-Button__icon': {
        color: tokens.colorNeutralForeground3,
      },
    },
  },
});

/** 触底续取预载边距，提前 600px 触发以保证快速滚动下的平滑衔接 */
const LOOKAHEAD = '0px 0px 600px 0px';

/**
 * 艺人发行作品列表底部状态栏：承载滚动触底自动续取、手动加载、重试与截断提示
 * 激活过滤条件时禁用自动触底以防无节制拉取至上限，转为手动加载；非墙面概览视图仅展示预览状态
 */
export function ReleaseTail({
  releases,
  scroller,
  wall,
}: {
  readonly releases: ArtistReleases;
  /** 滚动容器元素，作为交叉观察器的视口根节点 */
  readonly scroller: HTMLElement | null;
  readonly wall: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const pill = mergeClasses(controls.field, usePillStyles().pill);
  const { state, search, filtering } = releases;
  const ready = state?.phase === 'ready' ? state : null;
  const auto = wall && !!ready?.paused && !filtering;
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(releases.loadMore);
  useLayoutEffect(() => {
    latest.current = releases.loadMore;
  });
  // 每次列表更新重新挂载观察器：防止新页面高度不足以移出视口时丢失相交通知
  useEffect(() => {
    const target = sentinel.current;
    if (!auto || !target || !scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { root: scroller, rootMargin: LOOKAHEAD },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [auto, scroller]);

  const failed = !!ready?.moreFailed;
  const loading = wall && !failed && !!ready?.loadingMore;
  const manual = wall && !failed && !loading && !!ready?.paused && filtering;
  const limit = wall && !!ready?.truncated;
  return (
    <>
      <div ref={sentinel} className={styles.tail} data-artist-releases-tail>
        {failed && (
          <Button
            shape="circular"
            className={pill}
            icon={<ArrowClockwise16Regular />}
            iconPosition="after"
            data-artist-releases-more="retry"
            onClick={releases.retry}
          >
            {t('album.retry')}
          </Button>
        )}
        {loading && (
          <Button
            shape="circular"
            className={controls.field}
            icon={<Spinner size="extra-tiny" />}
            disabledFocusable
            aria-label={t('artistAlbums.loading')}
            aria-busy
            data-artist-releases-more="loading"
          />
        )}
        {manual && (
          <Button
            shape="circular"
            className={pill}
            icon={<ChevronDoubleDown16Regular />}
            iconPosition="after"
            data-artist-releases-more="more"
            onClick={releases.loadMore}
          >
            {t('artistAlbums.loadMore')}
          </Button>
        )}
        {limit && ready && (
          <span className={styles.note} data-artist-releases-limit>
            {t('artistAlbums.truncated', { count: ready.albums.length })}
          </span>
        )}
      </div>
      {(search.busy || search.failed || search.more) && (
        <div className={styles.search} data-artist-releases-search>
          {search.busy && <Spinner size="tiny" aria-label={t('artistAlbums.loading')} />}
          {search.failed && (
            <>
              <span>{t('artistAlbums.searchFailed')}</span>
              <Button size="small" onClick={releases.searchRetry}>
                {t('album.retry')}
              </Button>
            </>
          )}
          {search.more && (
            <Button size="small" onClick={releases.searchMore}>
              {t('search.more')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
