import {
  ArrowRedo20Regular,
  ArrowUndo20Regular,
  Delete20Regular,
  Target20Regular,
  TextBulletListAdd20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { RefObject } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { scrollQueueToCurrent } from '../../playback/queue/QueueEarlier.tsx';
import { queueUndoAtom } from '../../playback/queue/queueActions.ts';
import { queueKey } from '../../playback/queue/queueServices.ts';
import { queueViewAtom } from '../../playback/queue/queueState.ts';
import { ChipKey } from '../scene/ColumnChips.tsx';
import { FloatingBar, FloatingPiece } from '../scene/FloatingBar.tsx';
import { QueueSendMenu, useQueueSend } from './QueueSendMenu.tsx';

interface QueueToolbarProps {
  /** 队列的滚动容器：「定位当前」要滚它 */
  readonly scroller: RefObject<HTMLDivElement | null>;
}

/** 滚回当前曲目卡置顶的位置；减弱动效时直接落位 */
function useLocateCurrent(scroller: RefObject<HTMLDivElement | null>) {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  return () => {
    if (scroller.current) scrollQueueToCurrent(scroller.current, !reduced);
  };
}

/**
 * 队列页的悬浮工具条：撤销重做 ｜ 定位当前 ｜ 清空、转存播放列表
 *
 * 清空与转存作用于「已加入队列」那一段，所以放在一块；定位当前单独一块，不与清空相邻，免得误点
 * 没有曲目可操作时对应的键置灰（保持可聚焦，提示照常）；各块的拼法与毛玻璃见样式
 */
export function QueueToolbar({ scroller }: QueueToolbarProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { actions } = useService(queueKey);
  const undo = useAtomValueRawSync(queueUndoAtom);
  const queued = useAtomValueRawSync(queueViewAtom).entries.length;
  const locate = useLocateCurrent(scroller);
  const send = useQueueSend();
  return (
    <FloatingBar label={t('queue.shortcuts')}>
      <FloatingPiece position="first">
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
      </FloatingPiece>
      <FloatingPiece position="middle">
        <ChipKey icon={<Target20Regular />} label={t('queue.locateCurrent')} onClick={locate} />
      </FloatingPiece>
      <FloatingPiece position="last">
        <ChipKey
          icon={<Delete20Regular />}
          label={t('queue.clearQueued')}
          disabled={queued === 0}
          onClick={() => void actions.clear()}
        />
        <ChipKey
          icon={<TextBulletListAdd20Regular />}
          label={t('queue.sendQueued')}
          disabled={queued === 0}
          onClick={send.open}
        />
      </FloatingPiece>
      <QueueSendMenu send={send} />
    </FloatingBar>
  );
}
