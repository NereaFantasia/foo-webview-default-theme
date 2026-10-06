import { useEffect, useState } from 'react';

/** 滚轮调音量后，停下这么久没再滚就收起预览，毫秒。 */
export const VOLUME_PREVIEW_MS = 1000;

interface Preview {
  readonly value: number;
  /** 同一个值再滚一格也要重新计时：每次记下都是一个新对象。 */
  readonly serial: number;
}

export interface VolumePreview {
  /** 正在预览的位置（0–100，整数）；没在滚时为 null。 */
  readonly preview: number | null;
  /** 滚了一格，记下调到的位置。 */
  show(position: number): void;
}

/**
 * 滚轮调音量时的预览：每滚一格记下调到的位置，音量提示照它显示、不等宿主的音量事件；停下
 * `VOLUME_PREVIEW_MS` 没再滚就收起，提示回到宿主报的值（指针还在上面时）或收起。
 */
export function useVolumePreview(): VolumePreview {
  const [state, setState] = useState<Preview | null>(null);
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => setState(null), VOLUME_PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return {
    preview: state?.value ?? null,
    show: (position) =>
      setState((last) => ({ value: Math.round(position), serial: (last?.serial ?? 0) + 1 })),
  };
}
