import { useFocusFinders } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { historyAtom } from '../../nav/navHistory.ts';
import { pageTransition, type LayerMotion } from '../../motion/pageTransition.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { controlsVisibleAtom, type ImmersiveShell } from './immersiveShell.ts';
import { attachImmersiveRoot } from './keyFocus.ts';
import { PaperScene } from '../paper/PaperScene.tsx';
import { PerfOverlay } from '../perf/PerfOverlay.tsx';
import { ImmersiveControls } from './ImmersiveControls.tsx';
import styles from './ImmersiveView.module.css';

export interface ImmersiveViewProps {
  readonly shell: Pick<ImmersiveShell, 'touch' | 'toggleFullscreen' | 'leave'> | null;
  /** 这一页此刻是不是当前地点；离开后的退场过渡里为假。 */
  readonly current: boolean;
}

/** 在元素上播一组动画，先停掉它身上还在播的（进场没播完就离场，或离场没播完又被接回来）。 */
function play(element: HTMLElement, motions: readonly LayerMotion[]): void {
  for (const running of element.getAnimations()) running.cancel();
  for (const motion of motions) element.animate(motion.keyframes, motion.options);
}

/**
 * 进出这一页的过渡：与别的二级地点一样走 drill（`pageTransition.ts`），按历史记下的到达方式与方向。
 * 这一层挂在窗口顶层、不在中央区域的页面层里，那边的过渡动不到它，这里自己播；时长与那边相同，
 * 离场播完时页面层正好被移走。
 */
function useViewMotion(root: RefObject<HTMLElement | null>, current: boolean): void {
  const store = useStore();
  useLayoutEffect(() => {
    const element = root.current;
    const arrival = store.get(historyAtom).arrival;
    if (!element || !arrival) return;
    const motion = pageTransition(arrival.kind, arrival.direction, store.get(reducedMotionAtom));
    play(element, current ? motion.enter : motion.exit);
  }, [root, store, current]);
}

/**
 * 正在播放全屏页的视图：盖住整窗的一层（标题栏、侧边栏、内容卡都在它底下），里面是图纸场景、拖窗条与控件层。
 *
 * 指针与键盘都静止 3 s 后控件层与光标一起藏（`immersiveShell.ts`）；用键盘把焦点移到控件层的键上时不藏，
 * 视同有动作。动作只在这一层的根元素上听，Esc 不算动作：它是离开。焦点跟踪（`keyFocus.ts`）挂在根元素上，
 * 挂上时把焦点收进来，离开时还给进来前拿着焦点的那个元素；Tab 只在这一层里转，不落到底下被盖住的键上。
 * 离开后的退场过渡里整层不接指针与焦点。
 */
export function ImmersiveView({ shell, current }: ImmersiveViewProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controlsVisible = useAtomValueRawSync(controlsVisibleAtom);
  const [controlsFocused, setControlsFocused] = useState(false);
  const root = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const { findFirstFocusable, findLastFocusable } = useFocusFinders();
  const shown = controlsVisible || controlsFocused;

  useViewMotion(root, current);
  useEffect(() => {
    const element = root.current;
    if (!element || !current) return;
    return attachImmersiveRoot(element);
  }, [current]);

  // Tab 回绕的哨兵：焦点从层里的键退到哨兵上（Tab 走过了头）就绕到另一头的键；从根元素进来就落在近的这一头。
  // 层里一颗能拿焦点的键都没有时回到根元素。
  const guard = (edge: 'start' | 'end') => (event: FocusEvent<HTMLSpanElement>) => {
    const box = content.current;
    const from = event.relatedTarget;
    const overran = from instanceof Node && box !== null && box.contains(from);
    const first = edge === 'start' ? !overran : overran;
    const target = first ? findFirstFocusable(box) : findLastFocusable(box);
    (target ?? root.current)?.focus();
  };

  return (
    <section
      ref={root}
      className={styles.view}
      data-idle={!shown || undefined}
      tabIndex={-1}
      aria-label={t('place.nowPlaying')}
      inert={!current}
      onPointerMove={() => shell?.touch()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') shell?.touch();
      }}
    >
      <span className={styles.guard} tabIndex={0} aria-hidden onFocus={guard('start')} />
      <div ref={content} className={styles.content}>
        <PaperScene />
        <div className={styles.drag} aria-hidden />
        <ImmersiveControls shell={shell} shown={shown} onFocusWithin={setControlsFocused} />
        <PerfOverlay />
      </div>
      <span className={styles.guard} tabIndex={0} aria-hidden onFocus={guard('end')} />
    </section>
  );
}
