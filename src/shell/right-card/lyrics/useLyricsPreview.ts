import { createContext, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
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
    // 鼠标点击留下的焦点不能留在即将隐藏的控件里；键盘操作由 focused 保持可见。
    const parent = root.current;
    if (parent?.contains(document.activeElement)) {
      restoringFocus.current = true;
      parent.focus({ preventScroll: true });
      restoringFocus.current = false;
    }
  }, [visible]);

  const pointer = () => {
    setFocused(false);
    touch();
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

  return { root, toolbar, tabs, visible, pin, pointer, focus, blur, setMenuOpen };
}
