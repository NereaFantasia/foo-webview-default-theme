import { useFocusFinders } from '@fluentui/react-components';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { mainHistoryAtom } from '../../nav/navHistory.ts';
import { pageTransition, type LayerMotion } from '../../motion/pageTransition.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { controlsVisibleAtom, type ImmersiveShell } from './immersiveShell.ts';
import { attachImmersiveRoot } from './keyFocus.ts';
import { PaperScene } from '../paper/PaperScene.tsx';
import { PerfOverlay } from '../perf/PerfOverlay.tsx';
import { EntryStageContext, useEntryStages } from '../scene/entryStage.ts';
import { ControlSlotsContext, type ControlSlots } from '../scene/sceneContext.ts';
import { editOpenAtom, finishEdit } from './editSession.ts';
import { ImmersiveControls } from './ImmersiveControls.tsx';
import type { ImmersiveScene } from './immersivePrefs.ts';
import { PaperEdit } from './PaperEdit.tsx';
import { PresetsScene } from './PresetsScene.tsx';
import styles from './ImmersiveView.module.css';

export interface ImmersiveViewProps {
  readonly shell: Pick<ImmersiveShell, 'touch' | 'toggleFullscreen' | 'leave'> | null;
  /** 当前视图是否为活动地点。退场过渡期间为假 */
  readonly current: boolean;
  /** 当前激活的沉浸场景标识 */
  readonly scene: ImmersiveScene;
}

/** 在元素上播放一组动画，先停掉它身上还在播的（进场没播完就离场，或离场没播完又被接回来） */
function play(element: HTMLElement, motions: readonly LayerMotion[]): Animation[] {
  for (const running of element.getAnimations()) running.cancel();
  return motions.map((motion) => element.animate(motion.keyframes, motion.options));
}

/**
 * 进出这一页的过渡：与别的二级地点一样走 drill（`pageTransition.ts`），按历史记下的到达方式与方向。
 * 这一层挂在窗口顶层，不在中央区域的页面层里，那边的过渡动不到它，这里自己播放。时长与那边相同，
 * 离场播完时页面层正好被移走
 *
 * 返回进场是否播完（没有到达方式时没有过渡，视为已播完）；被取消的进场不算，重新进场时再等
 */
function useViewMotion(root: RefObject<HTMLElement | null>, current: boolean): boolean {
  const store = useStore();
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const arrival = store.get(mainHistoryAtom).arrival;
    if (!arrival) {
      if (current) setEntered(true);
      return;
    }
    const motion = pageTransition(arrival.kind, arrival.direction, store.get(reducedMotionAtom));
    const animations = play(element, current ? motion.enter : motion.exit);
    if (!current) return;
    let stale = false;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!stale) setEntered(true);
    });
    return () => {
      stale = true;
    };
  }, [root, store, current]);
  return entered;
}

/**
 * 正在播放全屏视图：覆盖主窗口全域（标题栏、侧边栏与内容卡均在其下方），内含当前活动场景、窗口拖拽区与悬浮控件层
 *
 * 指针与键盘都静止 3 s 后，控件层与光标一起隐藏（`immersiveShell.ts`）。用键盘把焦点移到控件层的按钮上时不隐藏，
 * 视同有动作。设置的编辑开着时也不隐藏，光标与编辑条一直在。动作只在这一层的根元素上监听，Esc 不算动作：
 * 它用于离开（编辑开着时 Esc 先结束编辑）。焦点跟踪（`keyFocus.ts`）挂在根元素上，挂上时把焦点收进来，
 * 离开时还给进来之前持有焦点的元素。Tab 只在这一层里循环，不会落到底下被盖住的按钮上。
 * 离开后的退场过渡里，整层不接收指针与焦点
 */
export function ImmersiveView({ shell, current, scene }: ImmersiveViewProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controlsVisible = useAtomValueRawSync(controlsVisibleAtom);
  const [controlsFocused, setControlsFocused] = useState(false);
  const store = useStore();
  const editing = useAtomValueRawSync(editOpenAtom);
  // 离开这一页时编辑按「完成」结束，下次进来不在编辑中
  useEffect(() => {
    if (!current) finishEdit(store);
  }, [store, current]);
  const root = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // 控制层留给场景元素的挂载点：控制层与场景是兄弟，经上下文交给场景里的元素
  const [slots, setSlots] = useState<ControlSlots>({ tabs: null, views: null, edit: null });
  const slotRefs = useMemo(
    () => ({
      tabs: (tabs: HTMLElement | null) =>
        setSlots((last) => (last.tabs === tabs ? last : { ...last, tabs })),
      views: (views: HTMLElement | null) =>
        setSlots((last) => (last.views === views ? last : { ...last, views })),
      edit: (edit: HTMLElement | null) =>
        setSlots((last) => (last.edit === edit ? last : { ...last, edit })),
    }),
    [],
  );
  const { findFirstFocusable, findLastFocusable } = useFocusFinders();
  const shown = controlsVisible || controlsFocused || editing;

  const stage = useEntryStages(useViewMotion(root, current));
  useEffect(() => {
    const element = root.current;
    if (!element || !current) return;
    return attachImmersiveRoot(element);
  }, [current]);

  // Tab 回绕的哨兵：焦点从层里的按钮退到哨兵上（Tab 走过了头）就绕到另一头的按钮。从根元素进来就落在近的这一头。层里没有可获取焦点的按钮时回到根元素
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
      data-immersive-view
      data-idle={!shown || undefined}
      data-editing={editing || undefined}
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
        <ControlSlotsContext value={slots}>
          <EntryStageContext value={stage}>
            {scene === 'paper' ? (
              <>
                <div className={styles.paper} inert={editing}>
                  <PaperScene />
                </div>
                <PaperEdit />
              </>
            ) : (
              <PresetsScene />
            )}
          </EntryStageContext>
          <div className={styles.drag} aria-hidden />
          <ImmersiveControls
            shell={shell}
            shown={shown}
            editing={editing}
            onFocusWithin={setControlsFocused}
            slotRefs={slotRefs}
          />
          <PerfOverlay />
        </ControlSlotsContext>
      </div>
      <span className={styles.guard} tabIndex={0} aria-hidden onFocus={guard('end')} />
    </section>
  );
}
