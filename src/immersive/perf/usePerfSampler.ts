import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useState } from 'react';
import type { SpectrumHistoryService } from '../spectrum/spectrumHistory.ts';
import { METER_WINDOW_MS } from './paintMeter.ts';
import { formatPerf, perSecondOf, perfOverlayEnabledAtom, perfTerrainAtom } from './perfOverlay.ts';

const NO_LINES: readonly string[] = [];

const supportsLoaf = (): boolean =>
  typeof PerformanceObserver !== 'undefined' &&
  PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');

/**
 * 性能小窗的采样：开着时跑一条 rAF 计数、挂长动画帧观察器、数宿主推来的频谱帧，每个统计窗（`METER_WINDOW_MS`）
 * 出一版字；关掉或卸下即停，字清空，关着时什么都不跑。rAF 次数是主线程出帧的节奏，不是屏幕上真正呈现的帧：
 * GPU 进程堵住时 rAF 照样跟满刷新率，呈现的帧却少得多，这只有 trace 看得到。
 *
 * 宿主帧数按频谱取数的帧计数（`version()`）在一窗里涨了多少算，`spectrum` 为 null（页面的服务还没起来）时按 0；
 * 换了一份取数服务，采样整个重起。山脊图的回报在每窗出字时从 `perfTerrainAtom` 现读。
 */
export function usePerfSampler(
  spectrum: Pick<SpectrumHistoryService, 'version'> | null,
): readonly string[] {
  const store = useStore();
  const enabled = useAtomValueRawSync(perfOverlayEnabledAtom);
  const [lines, setLines] = useState(NO_LINES);

  useEffect(() => {
    if (!enabled) return;
    const hostFrames = (): number => spectrum?.version() ?? 0;
    let windowStart = performance.now();
    let frames = 0;
    let lastFrame: number | null = null;
    let maxGap = 0;
    let loafCount = 0;
    let loafMax = 0;
    let hostBase = hostFrames();

    const tick = (time: number): void => {
      if (lastFrame !== null) maxGap = Math.max(maxGap, time - lastFrame);
      lastFrame = time;
      frames += 1;
      handle = requestAnimationFrame(tick);
    };
    let handle = requestAnimationFrame(tick);
    const loaf = supportsLoaf()
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            loafCount += 1;
            loafMax = Math.max(loafMax, entry.duration);
          }
        })
      : null;
    loaf?.observe({ type: 'long-animation-frame' });
    const timer = setInterval(() => {
      const now = performance.now();
      const span = now - windowStart;
      const host = hostFrames();
      setLines(
        formatPerf(
          {
            raf: { perSecond: perSecondOf(frames, span), maxGapMs: maxGap },
            loaf: loaf ? { perSecond: perSecondOf(loafCount, span), maxMs: loafMax } : null,
            hostPerSecond: perSecondOf(Math.max(0, host - hostBase), span),
            terrain: store.get(perfTerrainAtom),
          },
          now,
        ),
      );
      windowStart = now;
      frames = 0;
      maxGap = 0;
      loafCount = 0;
      loafMax = 0;
      hostBase = host;
    }, METER_WINDOW_MS);

    return () => {
      cancelAnimationFrame(handle);
      loaf?.disconnect();
      clearInterval(timer);
      setLines(NO_LINES);
    };
  }, [enabled, spectrum, store]);

  return enabled ? lines : NO_LINES;
}
