import { createPresenceComponent } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef } from 'react';
import { CURVE } from '../../motion/timing.ts';
import { Sidebar } from './Sidebar.tsx';
import { SIDEBAR_KEY_ATTR } from '../../nav/sidebar/SidebarKey.tsx';
import styles from './SidebarOverlay.module.css';
import { sidebarPrefsAtom } from '../../nav/sidebar/sidebarPrefs.ts';
import { RAIL_WIDTH } from '../../nav/sidebar/sidebarSnap.ts';
import { sidebarViewAtom, sidebarViewKey } from '../../nav/sidebar/sidebarView.ts';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { useService } from '../../kit/useService.ts';

/** 浮层打开与关闭的时长，毫秒：WinUI SplitView 的 `OpenOverlayLeft` 与 `OpenCompactOverlayLeft`。 */
const OPEN_MS = 350;
const CLOSE_MS = 120;

/**
 * 从图标条原地展开时裁剪从 48 放开，没有图标条（≤ 640）时从左边滑入；关闭反着走。
 * 减弱动效时 Fluent 把时长缩成 1 ms，结束事件照常发。
 */
const OverlayMotion = createPresenceComponent<{ fromRail: boolean }>(({ fromRail }) => {
  const keyframes = fromRail
    ? [{ clipPath: `inset(0 calc(100% - ${RAIL_WIDTH}px) 0 0)` }, { clipPath: 'inset(0 0 0 0)' }]
    : [{ translate: '-100% 0' }, { translate: '0 0' }];
  const easing = CURVE.decelerateMax.timing;
  return {
    enter: { keyframes, duration: OPEN_MS, easing },
    exit: { keyframes: [...keyframes].reverse(), duration: CLOSE_MS, easing },
  };
});

function sidebarKey(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${SIDEBAR_KEY_ATTR}]`);
}

/**
 * 窄窗里以浮层展开的整张侧边栏：641–1007 从图标条原地展开，≤ 640 从左边滑入，盖在内容上，不压暗。
 * 宽度用存的展开宽度。点外面、按 Esc、去了别的地点都关；改名或新建进行中点外面不关，只让名字框失焦
 * 提交。打开时焦点进到浮层里，关掉时焦点还在浮层里就还给标题栏的键。
 *
 * 窗口拉过 1008 时整个卸掉，不播关闭；由调用方只在窄的两档里挂它。
 */
export function SidebarOverlay() {
  const { tier, overlay } = useAtomValueRawSync(sidebarViewAtom);
  const { width } = useAtomValueRawSync(sidebarPrefsAtom);
  const sidebarView = useService(sidebarViewKey);
  const panel = useRef<HTMLDivElement>(null);

  const markInside = useLightDismiss({
    id: 'sidebar.overlay.dismiss',
    open: overlay,
    panel,
    exempt: (target) => target.closest(`[${SIDEBAR_KEY_ATTR}]`) !== null,
    held: () =>
      (panel.current?.querySelector('[data-rename-input], [data-new-playlist-input]') ?? null) !==
      null,
    onDismiss: () => sidebarView.closeOverlay(),
  });

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (overlay) {
      const target =
        element.querySelector<HTMLElement>('[aria-current="page"]') ??
        element.querySelector<HTMLElement>('button:not([disabled]):not([aria-disabled="true"])');
      target?.focus();
    } else if (element.contains(document.activeElement)) {
      sidebarKey()?.focus();
    }
  }, [overlay]);

  return (
    <OverlayMotion visible={overlay} appear unmountOnExit fromRail={tier === 'tight'}>
      <div
        ref={panel}
        className={styles.overlay}
        style={{ width }}
        data-sidebar-overlay
        onPointerDownCapture={markInside}
      >
        <Sidebar />
      </div>
    </OverlayMotion>
  );
}
