import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { DURATION_MS } from '../../motion/timing.ts';
import { trackSwapAtom, type TrackSwap } from '../../playback/now-playing/trackSwap.ts';
import type { TextSwapSource } from '../../playback/now-playing/useTextSwap.ts';
import type { CoverflowSelection } from '../scene/coverflowAtoms.ts';

/**
 * Coverflow 模式下焦点曲目切换的文字过渡状态管理
 *
 * 独立追踪浏览选中的键值与相对位置，衍生单调递增的换字序号与滑动方向；
 * 浏览历史曲目期间隔离全局换曲序号跳变，回位时补齐位移；若切歌与焦点移动并发发生，合并为单次过渡以全局换曲方向为准
 */
export interface SelectionSwapState {
  /** 当前跟踪的选中条目键名；非 coverflow 模式为 null */
  readonly key: string | null;
  readonly index: number;
  /** 焦点切换累计变更次数 */
  readonly bumps: number;
  readonly direction: TrackSwap['direction'];
  /** 最近一次焦点切换时的换曲序号；两端并发时记录为 -1 以交出方向控制权 */
  readonly anchor: number;
  /** 最近接收的全局换曲序号 */
  readonly seen: number;
  /** 冻结的基准换曲序号；非当前播放曲目浏览期间保持恒定 */
  readonly held: number;
}

export const INITIAL_SELECTION_SWAP: SelectionSwapState = {
  key: null,
  index: -1,
  bumps: 0,
  direction: 'none',
  anchor: -1,
  seen: -1,
  held: 0,
};

/** 焦点条目跟踪输入；browsing 标识是否处于非当前播放曲目浏览状态 */
type Tracked = {
  readonly key: string;
  readonly index: number;
  readonly browsing: boolean;
} | null;

/** 推进焦点切换状态机；仅在有效键值变化时递增序号，初始挂载不触发过渡 */
export function advanceSelectionSwap(
  state: SelectionSwapState,
  selection: Tracked,
  globalSerial: number,
): SelectionSwapState {
  const seen = globalSerial;
  if (!selection) {
    return state.key === null && state.seen === seen && state.held === seen
      ? state
      : { ...state, key: null, seen, held: seen };
  }
  if (state.key === null) {
    return { ...state, key: selection.key, index: selection.index, seen, held: seen };
  }
  if (state.key === selection.key) {
    const held = selection.browsing ? state.held : seen;
    return state.seen === seen && state.held === held ? state : { ...state, seen, held };
  }
  const direction =
    selection.index > state.index ? 'next' : selection.index < state.index ? 'previous' : 'none';
  return {
    key: selection.key,
    index: selection.index,
    bumps: state.bumps + 1,
    direction,
    anchor: seen === state.seen ? seen : -1,
    seen,
    held: selection.browsing ? state.held : seen,
  };
}

/**
 * 快速连续切换的动效防抖阈值（毫秒）
 *
 * 高频切换时跳过进场动画直接更新文本，避免文字在半透明与实色之间反复闪烁
 */
export const RAPID_SWAP_MS = DURATION_MS.normal;

/** 构建文本过渡驱动源；根据换曲记录与焦点切换的相对时序决定滑动方向 */
export function selectionSwapSource(state: SelectionSwapState, global: TrackSwap): TextSwapSource {
  const mine = state.bumps > 0 && state.anchor === global.serial;
  return {
    serial: state.held + state.bumps,
    kind: mine ? 'track' : global.kind,
    direction: mine ? state.direction : global.direction,
    rapidMs: RAPID_SWAP_MS,
  };
}

export function useSelectionSwap(selection: CoverflowSelection | null): TextSwapSource {
  const global = useAtomValueRawSync(trackSwapAtom);
  const [state, setState] = useState(INITIAL_SELECTION_SWAP);
  const next = advanceSelectionSwap(
    state,
    selection && {
      key: selection.item.key,
      index: selection.index,
      browsing: selection.item.kind !== 'current',
    },
    global.serial,
  );
  if (next !== state) setState(next);
  return selectionSwapSource(next, global);
}
