import { useEffect, useState } from 'react';
import type { CoverProfile } from '../theme/coverPalette.ts';
import { coverAnalysis, type CoverAnalysis } from './coverAnalysis.ts';

export interface CoverProfileOptions {
  readonly analysis?: Pick<CoverAnalysis, 'read' | 'peek'>;
  /** 先取按地址记下的档案，命中时当帧就有，不闪回全局色。封面会就地换图的（正在播放的）不要开。 */
  readonly reuse?: boolean;
}

/** URL 变化立即撤掉旧归属，并中止还在排队的读取。 */
export function useCoverProfile(
  url: string,
  { analysis = coverAnalysis, reuse = false }: CoverProfileOptions = {},
) {
  const [result, setResult] = useState<{ url: string; profile: CoverProfile | null } | null>(null);
  const known = reuse && url ? analysis.peek(url) : undefined;
  useEffect(() => {
    if (!url || known) return;
    const reading = new AbortController();
    void analysis.read(url, reading.signal).then(
      (profile) => {
        if (!reading.signal.aborted) setResult({ url, profile });
      },
      () => {
        if (!reading.signal.aborted) setResult({ url, profile: null });
      },
    );
    return () => reading.abort();
  }, [url, analysis, known]);
  return known ?? (result?.url === url ? result.profile : null);
}
