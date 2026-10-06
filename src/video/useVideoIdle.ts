import { useEffect, useRef, useState, type RefObject } from 'react';

export function useVideoIdle(controls: RefObject<HTMLElement | null>, playing: boolean) {
  const [visible, setVisible] = useState(true);
  const last = useRef(0);
  const keyboard = useRef(true);
  const touch = () => {
    last.current = Date.now();
    setVisible(true);
  };
  const pointer = () => {
    keyboard.current = false;
    touch();
  };
  const key = () => {
    keyboard.current = true;
    touch();
  };
  useEffect(() => {
    touch();
    if (!playing) return;
    const timer = setInterval(() => {
      if (controls.current?.querySelector('[aria-expanded="true"], :active')) {
        last.current = Date.now();
        return;
      }
      if (
        keyboard.current &&
        document.activeElement !== controls.current &&
        controls.current?.contains(document.activeElement)
      )
        return;
      if (Date.now() - last.current >= 3000) {
        if (
          document.activeElement !== controls.current &&
          controls.current?.contains(document.activeElement)
        )
          controls.current.focus({ preventScroll: true });
        setVisible(false);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [controls, playing]);
  return { visible: !playing || visible, touch, pointer, key };
}
