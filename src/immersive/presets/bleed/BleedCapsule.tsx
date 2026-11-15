import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useBarSurface } from '../../scene/acrylic.ts';
import styles from './BleedCapsule.module.css';
import { COLLAPSE_CURVE } from './capsuleMotion.ts';

export interface BleedCapsuleProps {
  /** 常驻显示的头部区域：包含曲目信息与更多操作按钮 */
  readonly head: ReactNode;
  /** 折叠收起的内容区域：包含进度控制与播放控制行 */
  readonly body: ReactNode;
  /** 保持展开状态：忽略指针悬停、键盘焦点与弹出浮层状态，始终处于展开态 */
  readonly open?: boolean;
}

const MOTION: CSSProperties & Record<`--${string}`, string> = {
  '--bleed-collapse-curve': COLLAPSE_CURVE,
};

/**
 * 封面底部的控制胶囊（预设 2 布局组件）
 *
 * 仅管理胶囊外形与展开交互，不识别其中的元素：收起态仅露出头部栏，展开态多出折叠部分，向上伸展、底边固定，鼠标从下方进入后仍在胶囊内
 * 展开判定条件：指针悬停于胶囊容器内、内部持有键盘焦点，或内部存在展开态的菜单与弹出层
 * 音量浮层或更多操作菜单打开期间不能收起，否则锚点会随收起的行一并消失
 * 悬停判定依循 React 合成事件树：挂载于 body 的按钮 Tooltip 与弹出面板在 DOM 结构上脱离胶囊，但在 React 树中仍属其子节点，
 * 指针移入此类元素时不触发收起（`onMouseEnter` 与 `onMouseLeave` 依循 React 树传递）
 * 位置、宽度与底边距由外层容器通过 CSS 变量（`--bleed-capsule-*`）注入。磨砂材质独立为渲染层，采用统一的 Acrylic 样式规范，文字保持固定尺寸
 */
export function BleedCapsule({ head, body, open = false }: BleedCapsuleProps) {
  const surface = useBarSurface();
  const [hover, setHover] = useState(false);
  const glass = useRef<HTMLDivElement>(null);
  // 视图过渡期间亚克力快照图层挂载于根节点，无法继承组件 CSS 变量，在此将圆角半径同步至根元素
  useLayoutEffect(() => {
    const element = glass.current;
    if (!element) return;
    const root = document.documentElement;
    root.style.setProperty('--scene-capsule-radius', getComputedStyle(element).borderTopLeftRadius);
    return () => {
      root.style.removeProperty('--scene-capsule-radius');
    };
  }, []);
  return (
    <div
      className={styles.capsule}
      style={MOTION}
      data-capsule
      data-edit-target="capsule"
      data-hover={hover || undefined}
      data-open={open || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div ref={glass} className={`${styles.glass} ${surface}`} aria-hidden />
      <div className={styles.head}>{head}</div>
      <div className={styles.fold}>
        <div className={styles.foldInner}>{body}</div>
      </div>
    </div>
  );
}
