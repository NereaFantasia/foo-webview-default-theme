import { useRef } from 'react';
import { QueueList } from '../../playback/queue/QueueList.tsx';
import { CARD_VARIABLES } from '../scene/cardVariables.ts';
import { CardColumn } from '../scene/CardColumn.tsx';
import { QueueToolbar } from './QueueToolbar.tsx';

/** 队列行基准高度（像素）；沉浸视图适配大封面规格 */
export const QUEUE_PAGE_ROW_HEIGHT = 56;

interface QueuePageProps {
  /** 侧栏列上沿位置与总高度（像素），与封面列整组对齐 */
  readonly top: number;
  readonly height: number;
}

/**
 * 队列列表在沉浸视图里的外观：卡片的共用部分取 `scene/cardVariables.ts`（行间的缝、圆角两头大中段小、封面、底色噪点模糊阴影、
 * 上下两端逐张淡出），这里补队列自己的：节头也是一张卡（上缘 24、下缘 8），已播的行（前面的曲目）底压暗、内容降档并略去色，
 * 看起来暗淡；「前面的曲目」的下内边距取渐隐带高，置顶时第一张节头卡落在渐隐带下面。变量清单与缺省值见队列行与队列列表的样式
 */
const QUEUE_VARIABLES = {
  ...CARD_VARIABLES,
  '--queue-earlier-pad': 'var(--queue-fade)',
  '--queue-head-size': 'var(--fontSizeBase300)',
  '--queue-head-sub-size': 'var(--fontSizeBase200)',
  '--queue-head-height': '48px',
  '--queue-head-pad': 'var(--spacingHorizontalL)',
  '--queue-head-radius':
    'var(--borderRadius4XLarge) var(--borderRadius4XLarge) var(--borderRadiusXLarge) var(--borderRadiusXLarge)',
  '--queue-head-bg': 'var(--queue-card-bg)',
  '--queue-head-gap': 'var(--spacingVerticalXXS)',
  '--queue-section-gap': 'var(--spacingVerticalM)',
} as const;

/**
 * 沉浸视图队列侧栏页
 *
 * 列内呈现手动队列与接下来播放两段，各自一张节头卡加一串行卡；支持向上滚动浏览前序曲目（平时隐藏）；
 * 快捷操作（撤销重做、定位当前、清空、转存播放列表）是悬浮在列底的三块拼贴工具条；
 * 当前播放曲目由主视图封面列展示，播放历史划归历史专页；底层列表交互由 QueueList 驱动
 */
export function QueuePage({ top, height }: QueuePageProps) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <CardColumn
      element="queue"
      top={top}
      height={height}
      fade={QUEUE_PAGE_ROW_HEIGHT}
      scrollerRef={scroller}
      toolbar={<QueueToolbar scroller={scroller} />}
    >
      <QueueList
        rowHeight={QUEUE_PAGE_ROW_HEIGHT}
        sectionClear={false}
        variables={QUEUE_VARIABLES}
      />
    </CardColumn>
  );
}
