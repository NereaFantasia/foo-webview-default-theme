import { useState, type CSSProperties, type ReactNode } from 'react';
import { useBarSurface } from '../../scene/acrylic.ts';
import { useRootRadius } from '../../scene/useRootRadius.ts';
import styles from './BleedCapsule.module.css';
import { COLLAPSE_CURVE } from './capsuleMotion.ts';

export interface BleedCapsuleProps {
  /** 始终显示的头部，例如曲目信息与「更多」按钮 */
  readonly head: ReactNode;
  /** 收起时隐藏的折叠部分，例如进度条与播放控制行 */
  readonly body: ReactNode;
  /** 为真时始终展开，不再根据悬停、焦点与浮层判断 */
  readonly open?: boolean;
}

const MOTION: CSSProperties & Record<`--${string}`, string> = {
  '--bleed-collapse-curve': COLLAPSE_CURVE,
};

/**
 * 封面底部的控制胶囊，用于预设 2 的布局
 *
 * 胶囊只管理外形与展开，不识别其中的元素。收起时只显示头部，展开时多出折叠部分。
 * 胶囊向上伸展，底边固定，因此指针从下方移入后仍在胶囊内。
 * 指针悬停在胶囊上、胶囊内有键盘焦点，或胶囊内有打开的菜单或弹出层时展开。
 * 音量浮层或「更多」菜单打开期间不能收起，否则它们的锚点会随折叠的行一起消失。
 * 悬停按 React 树判断：按钮的 Tooltip 与弹出面板挂载在 body 下，在 DOM 中位于胶囊之外，但在 React 树中仍是胶囊的子节点。
 * `onMouseEnter` 与 `onMouseLeave` 沿 React 树传递，因此指针移入这些元素时胶囊不收起。
 * 位置、宽度与底边距由外层容器经 CSS 变量（`--bleed-capsule-*`）设定。
 * 毛玻璃材质是单独的一层，使用统一的 Acrylic 样式，文字尺寸固定
 */
export function BleedCapsule({ head, body, open = false }: BleedCapsuleProps) {
  const surface = useBarSurface();
  const [hover, setHover] = useState(false);
  const glass = useRootRadius('--scene-capsule-radius');
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
