import { useEffect, useRef, type MouseEvent, type WheelEvent } from 'react';

/** 单击要等这么久（毫秒）才执行，期间再点一下就是双击 */
const DOUBLE_CLICK_MS = 250;
/** 滚轮累计到这么多像素算一档，鼠标滚轮一格约为一档 */
const WHEEL_STEP = 100;
/** 自己有用途的元素：点它们不算点画面 */
const OWN_CLICK = 'button,a,[role="button"],[role="slider"]';

export interface VideoGestures {
  readonly onClick: (event: MouseEvent) => void;
  readonly onDoubleClick: (event: MouseEvent) => void;
  readonly onWheel: (event: WheelEvent) => void;
}

/**
 * 画面上的鼠标操作：单击播放 / 暂停，双击切换全屏，滚轮调音量。单击推迟执行，双击时撤销，
 * 否则双击会先让声音停一下再放
 */
export function useVideoGestures({
  enabled,
  toggle,
  fullscreen,
  stepVolume,
  touch,
}: {
  readonly enabled: boolean;
  readonly toggle: () => void;
  readonly fullscreen: () => void;
  readonly stepVolume: (up: boolean) => void;
  readonly touch: () => void;
}): VideoGestures {
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheel = useRef(0);
  useEffect(() => () => clearTimeout(pending.current), []);
  const ignored = (event: MouseEvent) =>
    !enabled || (event.target instanceof Element && event.target.closest(OWN_CLICK) !== null);
  return {
    onClick(event) {
      if (ignored(event)) return;
      clearTimeout(pending.current);
      if (event.detail > 1) return;
      pending.current = setTimeout(toggle, DOUBLE_CLICK_MS);
    },
    onDoubleClick(event) {
      if (ignored(event)) return;
      clearTimeout(pending.current);
      fullscreen();
    },
    onWheel(event) {
      if (!enabled) return;
      wheel.current += event.deltaY;
      const steps = Math.trunc(wheel.current / WHEEL_STEP);
      if (steps === 0) return;
      wheel.current -= steps * WHEEL_STEP;
      touch();
      for (let index = 0; index < Math.abs(steps); index += 1) stepVolume(steps < 0);
    },
  };
}
