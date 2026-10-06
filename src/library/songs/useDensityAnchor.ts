import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { TrackTableHandle } from '../../table/TrackTable.tsx';

/**
 * 换了疏密之后视口顶上仍是原来那一首：歌曲表不分组、每行同高，滚动位置按行高的比例换算就落在同一行上。
 * 新行高下的表体高要等表格重算完位置才撑开，所以等到下一帧再滚；当场滚的话，行变高时会被旧的内容高夹住。
 */
export function useDensityAnchor(
  handle: RefObject<TrackTableHandle | null>,
  rowHeight: number,
): void {
  const previous = useRef(rowHeight);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = rowHeight;
    const scroller = handle.current?.scrollElement();
    if (before === rowHeight || before <= 0 || !scroller) return;
    const top = scroller.scrollTop;
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = (top * rowHeight) / before;
    });
    return () => cancelAnimationFrame(frame);
  }, [handle, rowHeight]);
}
