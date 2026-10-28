import {
  ArrowRedo20Regular,
  ArrowUndo20Regular,
  Delete20Regular,
  Target20Regular,
  TextBulletListAdd20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useRef, type CSSProperties, type RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { useService } from '../../kit/useService.ts';
import { scrollQueueToCurrent } from '../../playback/queue/QueueEarlier.tsx';
import { QueueList } from '../../playback/queue/QueueList.tsx';
import { queueUndoAtom } from '../../playback/queue/queueActions.ts';
import { queueKey } from '../../playback/queue/queueServices.ts';
import { queueViewAtom } from '../../playback/queue/queueState.ts';
import { ChipGroup, ChipKey } from '../scene/ColumnChips.tsx';
import { SideColumn } from '../scene/SideColumn.tsx';
import { QueueSendMenu, useQueueSend } from './QueueSendMenu.tsx';

/** 队列行基准高度（像素）；沉浸视图适配大封面规格 */
export const QUEUE_PAGE_ROW_HEIGHT = 56;

interface QueuePageProps {
  /** 侧栏列上沿位置与总高度（像素），与封面列整组对齐 */
  readonly top: number;
  readonly height: number;
}

// 前向曲目降低透明度且不铺底色；置顶时视口上边距对齐列顶渐隐带与内边距总和
const COLUMN_VARIABLES: CSSProperties & Record<`--${string}`, string> = {
  '--queue-earlier-pad': 'calc(var(--spacingVerticalM) + var(--spacingVerticalS))',
  '--queue-earlier-dim': '0.72',
  '--queue-head-size': 'var(--fontSizeBase300)',
  '--queue-head-sub-size': 'var(--fontSizeBase200)',
};

/**
 * 沉浸视图队列侧栏页
 *
 * 列头集成快捷操作药丸组（撤销/重做、定位当前、清空、转存播放列表）；
 * 列内呈现手动队列与接下来播放两段；支持向上滚动浏览前序曲目（平时隐藏）；
 * 当前播放曲目由主视图封面列展示，播放历史划归历史专页；底层列表交互由 QueueList 驱动
 */
export function QueuePage({ top, height }: QueuePageProps) {
  const t = useAtomValueRawSync(translateAtom);
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <SideColumn
      element="queue"
      top={top}
      height={height}
      head={<QueueHead scroller={scroller} />}
      headLabel={t('queue.shortcuts')}
      scrollerRef={scroller}
      style={COLUMN_VARIABLES}
    >
      <QueueList rowHeight={QUEUE_PAGE_ROW_HEIGHT} sectionClear={false} />
    </SideColumn>
  );
}

/** 滚回当前曲目卡置顶的位置；减弱动效时直接落位 */
function useLocateCurrent(scroller: RefObject<HTMLDivElement | null>) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  return () => {
    if (scroller.current) scrollQueueToCurrent(scroller.current, !reduced);
  };
}

function QueueHead({ scroller }: { readonly scroller: RefObject<HTMLDivElement | null> }) {
  const t = useAtomValueRawSync(translateAtom);
  const { actions } = useService(queueKey);
  const undo = useAtomValueRawSync(queueUndoAtom);
  const queued = useAtomValueRawSync(queueViewAtom).entries.length;
  const locate = useLocateCurrent(scroller);
  const send = useQueueSend();
  return (
    <>
      <ChipGroup>
        <ChipKey
          icon={<ArrowUndo20Regular />}
          label={t('queue.undo')}
          disabled={!undo.canUndo}
          onClick={() => void actions.undo()}
        />
        <ChipKey
          icon={<ArrowRedo20Regular />}
          label={t('queue.redo')}
          disabled={!undo.canRedo}
          onClick={() => void actions.redo()}
        />
      </ChipGroup>
      <ChipGroup>
        <ChipKey
          icon={<Delete20Regular />}
          label={t('queue.clearQueued')}
          disabled={queued === 0}
          onClick={() => void actions.clear()}
        />
        <ChipKey icon={<Target20Regular />} label={t('queue.locateCurrent')} onClick={locate} />
      </ChipGroup>
      <ChipGroup>
        <ChipKey
          icon={<TextBulletListAdd20Regular />}
          label={t('queue.sendQueued')}
          disabled={queued === 0}
          onClick={send.open}
        />
      </ChipGroup>
      <QueueSendMenu send={send} />
    </>
  );
}
