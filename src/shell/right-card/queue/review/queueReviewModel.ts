import type { UpNextTrack } from '../upNextModel.ts';

export interface ReviewTrack {
  readonly key: string;
  readonly track: UpNextTrack;
}

export interface QueueReviewView {
  /** 从早到晚排列，每个句柄最多一首，不含当前正在播放的曲目。 */
  readonly rows: readonly ReviewTrack[];
  readonly total: number;
  readonly version: number;
  readonly current: string | null;
  readonly direction: 'forward' | 'backward';
}

export const EMPTY_QUEUE_REVIEW: QueueReviewView = {
  rows: [],
  total: 0,
  version: 0,
  current: null,
  direction: 'forward',
};

export function reviewRowAt(view: QueueReviewView, index: number): ReviewTrack | null {
  return view.rows[index] ?? null;
}
