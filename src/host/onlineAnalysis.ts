import { trackAbilities, trackOrigin } from './trackOrigin.ts';

/**
 * 在线曲目的整轨分析（整轨波形、波形分频与 BPM、DR）怎么取：
 * - `hold`：先通知后端把整首留在内存里，几项分析共用这一份，上游只多下一遍，后端多占约一首的内存
 * - `segments`：不留，宿主按段直接向上游读，每项各读一遍，最多三遍，不占后端内存
 * - `off`：不做
 *
 * 只管在线曲目：本地文件照常读，电台流没有整轨，不论选哪档都不做
 */
export const ONLINE_ANALYSIS_CHOICES = ['hold', 'segments', 'off'] as const;
export type OnlineAnalysis = (typeof ONLINE_ANALYSIS_CHOICES)[number];
export const DEFAULT_ONLINE_ANALYSIS: OnlineAnalysis = 'hold';

/** 这一首的整轨分析怎么取：`skip` 不取，`read` 照原地址读，`hold` 先通知后端留这首再读 */
export type AnalysisPlan = 'skip' | 'read' | 'hold';

/** 整轨波形与两种 PCM 来源共用：按曲目来源与用户的选择定这一首怎么取 */
export function analysisPlan(path: string, online: OnlineAnalysis): AnalysisPlan {
  if (!trackAbilities(path).decodesAudio) return 'skip';
  if (trackOrigin(path) !== 'online') return 'read';
  return online === 'off' ? 'skip' : online === 'segments' ? 'read' : 'hold';
}
