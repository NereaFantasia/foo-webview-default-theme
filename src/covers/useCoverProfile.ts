import { useEffect, useState } from 'react';
import type { CoverProfile } from '../theme/coverPalette.ts';
import { coverAnalysis, type CoverAnalysis } from './coverAnalysis.ts';

/** URL 变化立即撤掉旧归属；共享请求不由单个消费者取消。 */
export function useCoverProfile(
  url: string,
  analysis: Pick<CoverAnalysis, 'read'> = coverAnalysis,
) {
  const [result, setResult] = useState<{ url: string; profile: CoverProfile | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    void analysis.read(url).then(
      (profile) => {
        if (active) setResult({ url, profile });
      },
      () => {
        if (active) setResult({ url, profile: null });
      },
    );
    return () => {
      active = false;
    };
  }, [url, analysis]);
  return result?.url === url ? result.profile : null;
}
