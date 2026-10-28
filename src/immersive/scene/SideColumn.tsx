import { mergeClasses } from '@fluentui/react-components';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { ACRYLIC_BLUR, ACRYLIC_SHADOW } from './acrylic.ts';
import { useSceneFrame } from './sceneContext.ts';
import { SIDE_EDGE, SIDE_MAX_WIDTH } from './sideBox.ts';
import styles from './SideColumn.module.css';

interface SideColumnProps {
  /** 写入根节点的 data-scene-element 标记 */
  readonly element: string;
  /** 列上沿相对侧栏顶部位移与总高度（像素），与封面列对齐 */
  readonly top: number;
  readonly height: number;
  /** 列头药丸操作区节点（ChipGroup） */
  readonly head: ReactNode;
  readonly headLabel: string;
  /** 滚动容器引用契约：供上层控制滚动位置 */
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  /** 底部边缘渐隐开关（默认开启） */
  readonly fadeEnd?: boolean;
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}

/**
 * 沉浸视图侧栏列容器（供队列页与历史页共用）
 *
 * 结构分为独立的列头操作区（药丸组）与带背景的滚动列主体；列主体使用半透明底色并叠加高斯模糊（对齐胶囊材质模糊半径），
 * 投影样式与工具栏统一；背景性能守门降级或开启减弱透明度时禁用模糊以降低渲染负载；
 * 列纵向范围与封面列整组对齐，横向宽度与边距对齐歌词排版规格；滚动内容在容器内平滑裁剪并支持边缘渐隐
 */
export function SideColumn(props: SideColumnProps) {
  const {
    element,
    top,
    height,
    head,
    headLabel,
    scrollerRef,
    fadeEnd = true,
    style,
    children,
  } = props;
  const degraded = useSceneFrame().degraded;
  const variables: CSSProperties & Record<`--${string}`, string> = {
    '--column-top': `${top}px`,
    '--column-height': `${height}px`,
    '--column-start': `${SIDE_EDGE.start}px`,
    '--column-end': `${SIDE_EDGE.end}px`,
    '--column-max': `${SIDE_MAX_WIDTH}px`,
    '--column-blur': ACRYLIC_BLUR,
    '--column-shadow': ACRYLIC_SHADOW,
    ...style,
  };
  return (
    <div
      className={styles.frame}
      style={variables}
      data-scene-element={element}
      data-degraded={degraded || undefined}
    >
      <div className={styles.head} role="toolbar" aria-label={headLabel}>
        {head}
      </div>
      <div className={styles.panel}>
        <div ref={scrollerRef} className={mergeClasses(styles.scroller, fadeEnd && styles.fadeEnd)}>
          {children}
        </div>
      </div>
    </div>
  );
}
