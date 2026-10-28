import { useEffect, useState } from 'react';

/** 进退场驻留相位状态定义 */
export type PresencePhase = 'idle' | 'enter' | 'leave';

export interface Presence {
  readonly open: boolean;
  readonly mounted: boolean;
  readonly phase: PresencePhase;
}

/**
 * 条件渲染进退场驻留管理 hook
 *
 * open 置否后维持 mounted 状态 lingerMs 毫秒以供退场过渡播放；lingerMs 为 0（如减弱动效）时立即卸载；
 * 初始挂载处于开启态时不触发展开相位；退场过渡中途重新打开时自动取消卸载定时器
 */
export function usePresence(open: boolean, lingerMs: number): Presence {
  const [state, setState] = useState<Presence>({ open, mounted: open, phase: 'idle' });
  if (state.open !== open) {
    setState(
      open
        ? { open, mounted: true, phase: 'enter' }
        : { open, mounted: lingerMs > 0, phase: lingerMs > 0 ? 'leave' : 'idle' },
    );
  }
  useEffect(() => {
    if (state.open || !state.mounted) return;
    const timer = setTimeout(
      () => setState((last) => (last.open ? last : { ...last, mounted: false, phase: 'idle' })),
      lingerMs,
    );
    return () => clearTimeout(timer);
  }, [state.open, state.mounted, lingerMs]);
  return state;
}
