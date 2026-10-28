import {
  createContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
} from 'react';
import { usePointerActivity } from '../../../kit/usePointerActivity.ts';

interface LyricsPreviewControls {
  readonly visible: boolean;
  pin(value: boolean): void;
}

export const LyricsPreviewContext = createContext<LyricsPreviewControls | null>(null);

export function useLyricsPreview(enabled: boolean) {
  const root = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const { active, touch } = usePointerActivity(1500);
  // 滚动只让滚动条露出来，不唤出控件：纯文本歌词滚动时控件保持隐藏
  const { active: scrolling, touch: touchScroll } = usePointerActivity(1500);
  const [pinned, pin] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const restoringFocus = useRef(false);
  const visible = !enabled || active || pinned || focused || menuOpen;

  useLayoutEffect(() => {
    if (enabled) touch();
  }, [enabled, touch]);

  useLayoutEffect(() => {
    const parent = root.current;
    const top = toolbar.current;
    const navigation = tabs.current;
    if (!enabled || !parent || !navigation) return;
    const measure = () => {
      parent.style.setProperty(
        '--lyrics-preview-top',
        `${(top?.getBoundingClientRect().height ?? 0) + navigation.getBoundingClientRect().height}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (top) observer.observe(top);
    observer.observe(navigation);
    return () => {
      observer.disconnect();
      parent.style.removeProperty('--lyrics-preview-top');
    };
  }, [enabled]);

  useLayoutEffect(() => {
    if (visible) return;
    // 鼠标点击留下的焦点不能留在即将隐藏的控件里；键盘操作由 focused 保持可见
    const parent = root.current;
    if (parent?.contains(document.activeElement)) {
      restoringFocus.current = true;
      parent.focus({ preventScroll: true });
      restoringFocus.current = false;
    }
  }, [visible]);

  const lastPointerX = useRef(-1);
  const lastPointerY = useRef(-1);

  const pointer = (event?: { type?: string; clientX: number; clientY: number }) => {
    // 过滤歌词播放动效或重排引起的虚假 pointermove（鼠标坐标未发生真实改变）
    if (event && event.type === 'pointermove') {
      if (event.clientX === lastPointerX.current && event.clientY === lastPointerY.current) {
        return;
      }
      lastPointerX.current = event.clientX;
      lastPointerY.current = event.clientY;
    } else if (event) {
      lastPointerX.current = event.clientX;
      lastPointerY.current = event.clientY;
    }
    setFocused(false);
    touch();
  };

  const pointerLeave = () => {
    lastPointerX.current = -1;
    lastPointerY.current = -1;
  };
  const focus = (event: FocusEvent<HTMLElement>) => {
    if (restoringFocus.current || !event.target.matches(':focus-visible')) return;
    setFocused(true);
    touch();
  };
  const blur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
    touch();
  };

  const scroll = useCallback(() => {
    if (enabled) touchScroll();
  }, [enabled, touchScroll]);
  const scrollbarsVisible = enabled && (active || scrolling);

  return {
    root,
    toolbar,
    tabs,
    visible,
    scrollbarsVisible,
    pin,
    pointer,
    pointerLeave,
    scroll,
    focus,
    blur,
    setMenuOpen,
  };
}
