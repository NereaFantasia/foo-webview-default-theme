import { useLayoutEffect, useRef } from 'react';
import { TileKeys, type TileKeysProps } from '../cover-tile/TileKeys.tsx';
import { dropReflow, REFLOW_FOLLOW_ATTR } from '../cover-tile/tileReflow.ts';

export interface AlbumTileKeysProps extends Pick<
  TileKeysProps,
  'hidden' | 'state' | 'onPlay' | 'onMore'
> {
  /** 所跟随图块的位置键；换列时同步执行位移（见 `cover-tile/tileReflow.ts`） */
  readonly follow: string;
  /** 目标图块在行层坐标系中的左上角与封面边长，单位 CSS 像素 */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** 关联折叠分组编号，与悬停图块保持联动平移（见 `foldGroups`） */
  readonly fold: number;
}

/**
 * 封面墙悬停操作按钮宿主容器
 * 采用双槽浮层复用机制（见 `tileKeySlots.ts`）：全网格仅维护两对按钮，分别处理当前悬停与上一图块的淡出，避免高频滚动创建 DOM 节点
 * 外框同步跟随目标图块移动与换列位移，并在下拉展开收起时执行分组平移
 */
export function AlbumTileKeys({ follow, x, y, size, fold, ...keys }: AlbumTileKeysProps) {
  const root = useRef<HTMLDivElement>(null);
  // 当指针切换至新图块时，先移除上一图块未完成的换列重排位移动画
  useLayoutEffect(() => {
    if (root.current) dropReflow(root.current);
  }, [follow]);
  return (
    <TileKeys
      {...keys}
      ref={root}
      data-tile-keys
      data-fold={fold || undefined}
      {...{ [REFLOW_FOLLOW_ATTR]: follow }}
      style={{ transform: `translate(${x}px, ${y}px)`, width: size, height: size }}
    />
  );
}
