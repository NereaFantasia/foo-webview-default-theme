import { useEffect } from 'react';

export function useVideoWakeLock(playing: boolean): void {
  useEffect(() => {
    if (!playing || !('wakeLock' in navigator)) return;
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    async function refresh(): Promise<void> {
      if (document.visibilityState !== 'visible') {
        await lock?.release().catch(() => {});
        lock = null;
        return;
      }
      if (disposed || pending || (lock && !lock.released)) return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed || document.visibilityState !== 'visible') await next.release();
        else lock = next;
      } catch {
        // 电源策略可以拒绝常亮请求，不影响音频或画面播放。
      } finally {
        pending = false;
      }
    }
    document.addEventListener('visibilitychange', refresh);
    void refresh();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', refresh);
      void lock?.release().catch(() => {});
    };
  }, [playing]);
}
