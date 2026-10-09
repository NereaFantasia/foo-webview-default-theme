import { makeStyles, tokens, useEventCallback } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { SidePanel } from '../../kit/SidePanel.tsx';
import { CURVE, DURATION_MS, motionDuration } from '../../motion/timing.ts';
import { reducedMotionAtom } from '../../motion/reducedMotion.ts';
import { Sidebar } from './Sidebar.tsx';
import { SIDEBAR_KEY_ATTR } from '../../nav/sidebar/SidebarKey.tsx';
import { sidebarPrefsAtom } from '../../nav/sidebar/sidebarPrefs.ts';
import {
  sidebarViewAtom,
  sidebarViewKey,
  type SidebarTier,
} from '../../nav/sidebar/sidebarView.ts';
import { useLightDismiss } from '../../nav/useLightDismiss.ts';
import { useService } from '../../kit/useService.ts';

const useStyles = makeStyles({
  nav: { padding: tokens.spacingVerticalM, overflowY: 'auto' },
});

function sidebarKey(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${SIDEBAR_KEY_ATTR}]`);
}

/** 图标栏保持挂载；开合只改变绘制和交互，浮层实际退场后才开始恢复。 */
function useRailFade(
  rail: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  tier: SidebarTier,
  open: boolean,
  reduced: boolean,
) {
  const running = useRef<Animation | null>(null);
  const fade = useEventCallback((visible: boolean) => {
    const node = rail.current;
    if (!node || tier !== 'tight') return;
    const from = Number(getComputedStyle(node).opacity);
    const to = visible ? 1 : 0;
    running.current?.cancel();
    running.current = null;
    if (node.contains(document.activeElement)) sidebarKey()?.focus({ preventScroll: true });
    node.inert = true;
    node.style.visibility = 'visible';
    node.style.opacity = String(to);
    const settle = () => {
      node.style.visibility = visible ? '' : 'hidden';
      node.style.opacity = visible ? '' : '0';
      node.inert = !visible;
    };
    if (from === to) {
      settle();
      return;
    }
    const animation = node.animate([{ opacity: from }, { opacity: to }], {
      duration: motionDuration(DURATION_MS.faster * Math.abs(to - from), reduced),
      easing: CURVE.linear.timing,
    });
    running.current = animation;
    void animation.finished.then(
      () => {
        if (running.current !== animation) return;
        running.current = null;
        settle();
        animation.cancel();
      },
      () => {},
    );
  });

  useLayoutEffect(() => {
    const node = rail.current;
    if (!node) return;
    const original = {
      opacity: node.style.opacity,
      visibility: node.style.visibility,
      inert: node.inert,
    };
    // 跨档时新图标栏直接跟随浮层是否仍在，不在窗口重排中补播淡变。
    const hidden = tier === 'tight' && panel.current !== null;
    node.style.opacity = hidden ? '0' : original.opacity;
    node.style.visibility = hidden ? 'hidden' : original.visibility;
    node.inert = hidden || original.inert;
    return () => {
      running.current?.cancel();
      running.current = null;
      node.style.opacity = original.opacity;
      node.style.visibility = original.visibility;
      node.inert = original.inert;
    };
  }, [panel, rail, reduced, tier]);

  useLayoutEffect(() => {
    if (open) fade(false);
  }, [fade, open]);

  return useEventCallback(() => {
    if (!open) fade(true);
  });
}

interface SidebarOverlayProps {
  readonly rail: RefObject<HTMLElement | null>;
}

/**
 * 窄窗侧栏与右侧浮层在同一内容区域定位，整张从左边滑入，盖在内容上，不压暗。
 * 中窄档用保存的展开宽度，极窄档占满两侧留白之间的空间。点外面、按 Esc、去了别的地点都关；
 * 改名或新建进行中点外面不关，只让名字框失焦提交。打开时焦点进到浮层里，关掉时焦点还在浮层里就还给入口键。
 *
 * 窗口拉过 1008 时整个卸掉，不播关闭；由调用方只在窄的两档里挂它。
 */
export function SidebarOverlay({ rail }: SidebarOverlayProps) {
  const classes = useStyles();
  const { tier, overlay } = useAtomValueRawSync(sidebarViewAtom);
  const { width } = useAtomValueRawSync(sidebarPrefsAtom);
  const sidebarView = useService(sidebarViewKey);
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const revealRail = useRailFade(rail, panel, tier, overlay, reduced);

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
    <SidePanel
      ref={panel}
      side="start"
      open={overlay}
      style={tier === 'hidden' ? undefined : { width }}
      data-sidebar-overlay
      data-compact={tier === 'hidden' || undefined}
      onPointerDownCapture={markInside}
      onMotionFinish={(_, { direction }) => {
        if (direction === 'exit') revealRail();
      }}
    >
      <Sidebar className={classes.nav} />
    </SidePanel>
  );
}
