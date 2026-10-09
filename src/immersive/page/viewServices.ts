import { createContext, useContext } from 'react';
import type { Atom } from 'jotai/vanilla';
import type { PlaybackService } from '../../playback/playbackContract.ts';
import type { ImmersiveCoverService } from '../cover/immersiveCover.ts';
import type { SpectrumHistoryService } from '../spectrum/spectrumHistory.ts';
import type { StereoSamplesService } from '../stereo/stereoSamples.ts';
import type { TerrainHistoryService } from '../terrain/terrainHistory.ts';

/**
 * 正在播放全屏页里的件要调的服务实例：传输键与整轨波形发播放命令，罗盘的封面回报图片加载结果，
 * 频谱柱、山脊图与声场读不进 store 的高频数据。状态照常从各服务的 atom 读；这里只放要调方法、
 * 或数据不进 store 的那几样。页面的服务还没起来（首帧、页面已离开）时后几样为 null，件按没有数据画。
 */
export interface ViewServices {
  readonly active: Atom<boolean>;
  /** 完整窗口可显示；退出后的最后画面也要在隐藏时立即释放。 */
  readonly visible: Atom<boolean>;
  readonly playback: Pick<PlaybackService, 'playOrPause' | 'previous' | 'next' | 'seek'>;
  readonly cover: Pick<ImmersiveCoverService, 'markLoaded' | 'markFailed'> | null;
  readonly spectrum: Pick<
    SpectrumHistoryService,
    'history' | 'frame' | 'version' | 'interval' | 'subscribe'
  > | null;
  readonly terrain: Pick<TerrainHistoryService, 'history' | 'version' | 'subscribe'> | null;
  readonly stereo: Pick<StereoSamplesService, 'points' | 'readings' | 'subscribe'> | null;
}

export const ViewServicesContext = createContext<ViewServices | null>(null);

export function useViewServices(): ViewServices {
  const services = useContext(ViewServicesContext);
  if (!services) throw new Error('useViewServices 只能在正在播放全屏页之内调用');
  return services;
}
