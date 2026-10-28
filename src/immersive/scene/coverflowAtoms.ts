import { atom, type Atom } from 'jotai/vanilla';
import { currentTrackAtom } from '../../playback/playback.ts';
import { queueViewAtom } from '../../playback/queue/queueState.ts';
import { queueReviewAtom } from '../../playback/queue/review/queueReview.ts';
import { upEarlierAtom, upNextAtom } from '../../playback/queue/upNext.ts';
import { coverflowItems, selectedIndexOf, type CoverflowItem } from './coverflowItems.ts';
import { sceneStateAtom } from './sceneActions.ts';

/** 封面流条目序列衍生原子；聚合历史/上下文前向曲目、当前曲目、插队队列及后续曲目，各段变更时自动重排 */
export const coverflowItemsAtom: Atom<CoverflowItem[]> = atom((get) =>
  coverflowItems({
    review: get(queueReviewAtom).rows,
    earlier: get(upEarlierAtom),
    current: get(currentTrackAtom),
    queue: get(queueViewAtom).entries,
    upNext: get(upNextAtom),
  }),
);

export interface CoverflowSelection {
  readonly item: CoverflowItem;
  /** 在条目表中的索引位置，用于判断切换焦点时的移动方向 */
  readonly index: number;
}

/**
 * 封面流当前选中条目原子
 *
 * 仅在 coverflow 模式下读取条目表并计算当前浏览项（默认回退至当前曲目），避免非封面流模式承担衍生重排开销
 */
export const coverflowSelectionAtom: Atom<CoverflowSelection | null> = atom((get) => {
  const { mode, browsed } = get(sceneStateAtom);
  if (mode !== 'coverflow') return null;
  const items = get(coverflowItemsAtom);
  const index = selectedIndexOf(items, browsed);
  const item = items[index];
  return item ? { item, index } : null;
});
