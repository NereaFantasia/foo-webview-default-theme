import type { CSSProperties, ReactNode, RefObject } from 'react';
import { ACRYLIC_BAR_TINT, ACRYLIC_FILTER, ACRYLIC_SOLID_FILL } from './acrylic.ts';
import { listMaterialVariables, useListMaterial } from './listMaterial.ts';
import { useSceneFrame } from './sceneContext.ts';
import { SIDE_EDGE, SIDE_MAX_WIDTH } from './sideBox.ts';
import styles from './CardColumn.module.css';

interface CardColumnProps {
  /** 写入根节点的 data-scene-element 标记 */
  readonly element: string;
  /** 列上沿相对侧栏顶部的位移与总高度（像素），与封面列对齐 */
  readonly top: number;
  readonly height: number;
  /** 渐隐带高（像素），取列表一行的高：卡要在碰到滚动容器的裁切线之前淡完，带至少得有一张卡那么高 */
  readonly fade: number;
  /** 悬浮在列底的工具条 */
  readonly toolbar: ReactNode;
  /** 滚动容器的引用：供上层控制滚动位置 */
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}

/**
 * 沉浸视图侧栏列的外壳（队列页、历史页共用）
 *
 * 只给位置、宽度与滚动容器，行与节头的外观由列表自己画（变量清单与归属见 `scene/cardVariables.ts`）；工具条悬浮在列底
 * 位置与宽度：上沿与高度由预设写进来（对齐封面列整组），左缘、右边距与宽度上限同歌词栏的文字区（`sideBox.ts`）
 * 滚动容器向上下各多伸出一条渐隐带（`fade`，写成 `--queue-fade`），带在整组之外，整组范围内的卡是不透明的，
 * 静止时第一张卡与整组上沿齐；工具条仍锚在列底，不随容器伸出。上下两端的卡随滚动淡出、变糊，写在样式里
 * 材质变量写在这里：工具条各块取用毛玻璃的底色、模糊、投影（`--float-*`、`--column-shadow`），与沉浸视图其他悬浮胶囊同一份；
 * 行卡与节头卡取底色、噪点、阴影、背后的模糊（`scene/listMaterial.ts`）。帧率守门降级时标 `data-degraded`，两处都改用近实底
 */
export function CardColumn(props: CardColumnProps) {
  const { element, top, height, fade, toolbar, scrollerRef, children } = props;
  const degraded = useSceneFrame().degraded;
  const material = useListMaterial();
  const variables: CSSProperties & Record<`--${string}`, string> = {
    '--column-top': `${top}px`,
    '--column-height': `${height}px`,
    '--queue-fade': `${fade}px`,
    '--column-start': `${SIDE_EDGE.start}px`,
    '--column-end': `${SIDE_EDGE.end}px`,
    '--column-max': `${SIDE_MAX_WIDTH}px`,
    '--float-tint': ACRYLIC_BAR_TINT,
    '--float-blur': ACRYLIC_FILTER,
    '--float-solid': ACRYLIC_SOLID_FILL,
    ...listMaterialVariables(material),
  };
  return (
    <div
      className={styles.frame}
      style={variables}
      data-scene-element={element}
      data-degraded={degraded || undefined}
    >
      <div ref={scrollerRef} className={styles.scroller}>
        {children}
      </div>
      {toolbar}
    </div>
  );
}
