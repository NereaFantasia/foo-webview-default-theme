import { createPresenceComponent } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { CURVE } from '../../motion/timing.ts';
import { CONTENT_MIN, RIGHT_CARD_WIDTH } from './rightCard.ts';
import { RightCard } from './RightCard.tsx';
import { RIGHT_CARD_KEY_ATTR, RightCardContext } from './rightCardContext.ts';
import styles from './RightCardDock.module.css';
import type { RightCardServices } from './rightCardServices.ts';
import { GUTTER, RightCardSplitter } from './RightCardSplitter.tsx';

/**
 * 停靠时开合照 WinUI SplitView 的窗格（与内容并排）：版式第 0 帧就到终值，卡从右缘裁剪露出，200 ms；
 * 收起 100 ms，播完才卸下。曲线是窗格那一条。
 */
const DOCK_OPEN_MS = 200;
const DOCK_CLOSE_MS = 100;

/** 浮层开合照 SplitView 的浮层窗格：从右边滑入 350 ms，滑出 120 ms。 */
const OVERLAY_OPEN_MS = 350;
const OVERLAY_CLOSE_MS = 120;

const DockMotion = createPresenceComponent(() => {
  const keyframes = [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }];
  const easing = CURVE.pane.timing;
  return {
    enter: { keyframes, duration: DOCK_OPEN_MS, easing },
    exit: { keyframes: [...keyframes].reverse(), duration: DOCK_CLOSE_MS, easing },
  };
});

/** 滑出时多走一截，让过浮层与内容区右缘之间的那道缝，最后一帧不在窗口边上留一条。 */
const OverlayMotion = createPresenceComponent(() => {
  const keyframes = [{ translate: 'calc(100% + 16px) 0' }, { translate: '0 0' }];
  const easing = CURVE.decelerateMax.timing;
  return {
    enter: { keyframes, duration: OVERLAY_OPEN_MS, easing },
    exit: { keyframes: [...keyframes].reverse(), duration: OVERLAY_CLOSE_MS, easing },
  };
});

export interface RightCardDockProps {
  readonly services: RightCardServices;
  /** 内容卡顶部有导航行：浮层从它下面开始。 */
  readonly navRow: boolean;
  /** 内容卡底部浮着胶囊：浮层的底边让出它。 */
  readonly capsule: boolean;
  /** 窗口窄于 641：浮层铺满内容卡。 */
  readonly compact: boolean;
  /** 内容卡。 */
  readonly children: ReactNode;
}

/** 浮层用 Esc 收起时焦点回到开它的键上；键不在（窄窗收掉了）就交给内容卡。 */
function returnFocus(page: string): void {
  const key = document.querySelector<HTMLElement>(`[${RIGHT_CARD_KEY_ATTR}="${page}"]`);
  key?.focus();
}

/**
 * 右侧卡与内容卡放在一起的那一层。宽窗里卡停靠在内容卡右边，中间是 8 的拖拽条；卡的宽度照存的，内容卡
 * 至少留 480，不够时卡让宽，最窄 300。窄窗里卡不占位，盖在内容卡右侧（≤ 640 时铺满），点外面、按 Esc 收起。
 *
 * 停靠的卡收起时版式当场回到只有内容卡一列，卡还要播完收起：这期间它按收起前量下的宽度浮在原位，压在
 * 已经变宽的内容卡上，播完卸下。
 */
export function RightCardDock({
  services,
  navRow,
  capsule,
  compact,
  children,
}: RightCardDockProps) {
  const { prefs, form } = useAtomValueRawSync(services.card.view);
  const dock = useRef<HTMLDivElement>(null);
  const docked = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // 停靠时卡实际画出来的宽，收起那一程按它画。
  const dockedWidth = useRef<number>(prefs.width);
  const markInside = useLightDismiss({
    id: 'rightCard.dismiss',
    open: form === 'overlay',
    panel,
    exempt: (target) => target.closest(`[${RIGHT_CARD_KEY_ATTR}]`) !== null,
    onDismiss: (escape) => {
      services.card.close();
      if (escape) returnFocus(prefs.page);
    },
  });
  useLayoutEffect(() => {
    if (form === 'docked' && docked.current) {
      dockedWidth.current = docked.current.getBoundingClientRect().width;
    }
  });
  const columns =
    form === 'docked'
      ? `minmax(0, 1fr) ${GUTTER}px clamp(${RIGHT_CARD_WIDTH.min}px, calc(100% - ${CONTENT_MIN + GUTTER}px), ${prefs.width}px)`
      : undefined;
  const leaving = form !== 'docked';
  return (
    <RightCardContext value={services}>
      <div
        ref={dock}
        className={styles.dock}
        style={columns ? { gridTemplateColumns: columns } : undefined}
      >
        {children}
        {form === 'docked' && <RightCardSplitter dock={dock} />}
        <DockMotion visible={form === 'docked'} unmountOnExit>
          <div
            ref={docked}
            className={styles.card}
            data-form="docked"
            data-leaving={leaving || undefined}
            style={leaving ? { width: dockedWidth.current } : undefined}
          >
            <RightCard />
          </div>
        </DockMotion>
        <OverlayMotion visible={form === 'overlay'} unmountOnExit>
          <div
            ref={panel}
            className={styles.card}
            data-form="overlay"
            data-nav-row={navRow || undefined}
            data-capsule={capsule || undefined}
            data-compact={compact || undefined}
            onPointerDownCapture={markInside}
          >
            <RightCard />
          </div>
        </OverlayMotion>
      </div>
    </RightCardContext>
  );
}
