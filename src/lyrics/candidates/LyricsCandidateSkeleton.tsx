import { Skeleton, SkeletonItem } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import styles from './LyricsCandidateSkeleton.module.css';

const PLACEHOLDERS = [0, 1, 2] as const;

/**
 * 歌词检索加载中骨架屏占位
 *
 * 渲染三张与候选卡片等高的骨架占位以撑开容器高度，避免结果载入时高度跳变；
 * 读屏呈现正在搜索无障碍状态描述，骨架节点对辅助技术隐藏
 */
export function LyricsCandidateSkeleton() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <div className={styles.list} role="status" aria-label={t('lyrics.searching')}>
      <Skeleton aria-hidden>
        {PLACEHOLDERS.map((index) => (
          <div key={index} className={styles.card} data-lyrics-skeleton>
            <SkeletonItem className={styles.cover} shape="rectangle" size={56} />
            <SkeletonItem className={styles.title} size={16} />
            <SkeletonItem className={styles.byline} size={12} />
            <SkeletonItem className={styles.meta} size={12} />
          </div>
        ))}
      </Skeleton>
    </div>
  );
}
