import { useEffect, useMemo, useRef } from 'react';
import type { DesktopLyricsPopup } from './desktopLyricsPopup.ts';

/** 指针从靠边处离开后收起遮罩前等多久，毫秒；回来就不收 */
const LEAVE_MS = 300;
/** 指针在窗口中间「离开」多半是按下或开始拖窗时宿主抓了鼠标，等久一些，期间有指针活动就当没离开 */
const CAPTURE_LEAVE_MS = 2000;
/** 离窗口边缘这么近才算从边上离开，CSS 像素 */
const EDGE_MARGIN = 24;

/**
 * 页面自己判断的悬停。宿主在鼠标按下、开始拖窗时会抓鼠标，Windows 随之报一次离开，宿主照转给页面
 * （插件 `src/webview/WebViewHostInput.cpp` 的 `WebViewHost::HandleMouseMessage`）；这时指针其实还在窗口上
 * 所以按下期间不认离开；离开时看最后的位置，在中间的按抓鼠标处理、宽限久一些；改尺寸时也保持着
 */
export function usePageHover(popup: Pick<DesktopLyricsPopup, 'setPointerInside'>) {
  const pressed = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handlers = useMemo(() => {
    const clear = () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
    };
    const inside = (event?: { clientX: number; clientY: number }) => {
      if (event) last.current = { x: event.clientX, y: event.clientY };
      clear();
      popup.setPointerInside(true);
    };
    const leaveAfter = (ms: number) => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = undefined;
        popup.setPointerInside(false);
      }, ms);
    };
    return {
      inside,
      leaveAfter,
      clear,
      onPointerEnter: inside,
      onPointerMove: inside,
      onPointerDown(event: { clientX: number; clientY: number }) {
        pressed.current = true;
        inside(event);
      },
      onPointerLeave() {
        if (pressed.current) return;
        const { x, y } = last.current;
        const edge =
          x < EDGE_MARGIN ||
          y < EDGE_MARGIN ||
          x > globalThis.innerWidth - EDGE_MARGIN ||
          y > globalThis.innerHeight - EDGE_MARGIN;
        leaveAfter(edge ? LEAVE_MS : CAPTURE_LEAVE_MS);
      },
    };
  }, [popup]);
  useEffect(() => {
    const onUp = (event: PointerEvent) => {
      pressed.current = false;
      const { clientX: x, clientY: y } = event;
      if (x < 0 || y < 0 || x > globalThis.innerWidth || y > globalThis.innerHeight)
        handlers.leaveAfter(LEAVE_MS);
    };
    // 拖边改尺寸时指针在边框上，页面收不到移动；尺寸在变就当指针还在
    const onResize = () => {
      handlers.inside();
      handlers.leaveAfter(LEAVE_MS);
    };
    globalThis.addEventListener('pointerup', onUp);
    globalThis.addEventListener('resize', onResize);
    return () => {
      globalThis.removeEventListener('pointerup', onUp);
      globalThis.removeEventListener('resize', onResize);
      handlers.clear();
    };
  }, [handlers]);
  return handlers;
}
