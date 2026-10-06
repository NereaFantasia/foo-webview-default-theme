import { atom, type Atom } from 'jotai/vanilla';
import { useEffect, useState } from 'react';
import type { Store } from '../../kit/store.ts';
import { hostFullRatePcm, hostPcmSource } from '../analysis/hostPcmSource.ts';
import { startTrackAnalysis } from '../analysis/trackAnalysis.ts';
import { startImmersiveCover, type ImmersiveCoverService } from '../cover/immersiveCover.ts';
import { startTrackExtras } from '../fields/trackExtras.ts';
import { startLiveLoudness } from '../gauges/liveLoudness.ts';
import { startTrackDynamics } from '../gauges/trackDynamics.ts';
import { sceneTierAtom } from '../paper/sceneTier.ts';
import { loadPerfOverlay, togglePerfOverlay } from '../perf/perfOverlay.ts';
import {
  spectrumStatusAtom,
  startSpectrumHistory,
  type SpectrumHistoryService,
} from '../spectrum/spectrumHistory.ts';
import { startStereoSamples, type StereoSamplesService } from '../stereo/stereoSamples.ts';
import { startTerrainHistory, type TerrainHistoryService } from '../terrain/terrainHistory.ts';
import { startCoverSource } from '../wash/coverSource.ts';
import { startFullWaveform } from '../waveform/fullWaveform.ts';
import { needsBands } from '../waveform/waveformModes.ts';
import { registerImmersiveCommands } from './immersiveKeys.ts';
import {
  immersiveHostFullscreenAtom,
  immersiveTerrainAtom,
  loadImmersivePrefs,
  waveformModeAtom,
} from './immersivePrefs.ts';
import { startImmersiveShell, type ImmersiveShell } from './immersiveShell.ts';
import { useService } from '../../kit/useService.ts';
import { useStore } from 'jotai/react';
import { historyKey } from '../../nav/navHistory.ts';
import { commandsKey } from '../../nav/commandRegistry.ts';
import { playbackKey } from '../../playback/playbackContract.ts';

/** 这一页开着时跑着的服务里，页面要直接调的、或要读不进 store 的高频数据的那几个。 */
export interface RunningServices {
  readonly shell: ImmersiveShell;
  readonly cover: ImmersiveCoverService;
  readonly spectrum: SpectrumHistoryService;
  readonly terrain: TerrainHistoryService;
  readonly stereo: StereoSamplesService;
}

/**
 * 分频画法要分频结果，full 档舞台上的 BPM 格要逐拍拍点；两样同一次解码出，只要有一样在用就取。
 * 场景还没报档位时不按舞台算，免得窗口小、落在收缩档时进页那一刻白起一次解码。
 */
const ANALYSIS_WANTED: Atom<boolean> = atom(
  (get) => needsBands(get(waveformModeAtom)) || get(sceneTierAtom) === 'full',
);

/** 已经读过偏好存档的 store：存档整页只读一次，再读会盖掉这次启动里改过、却没存下的值。 */
const loadedStores = new WeakSet<Store>();

function loadPrefsOnce(store: Store): void {
  if (loadedStores.has(store)) return;
  loadedStores.add(store);
  loadImmersivePrefs(store);
  loadPerfOverlay(store);
}

/**
 * 正在播放全屏页的服务：这一页是当前地点时起，不再是（后退、去了别处）或页面卸下时按相反顺序释放。
 * 页面在退场过渡里还挂着时服务已经停了，各件不再更新，声场读数这类要调服务的回到没有数据的样子；
 * 退场被接回来（又回到这条记录）时重起一套。
 *
 * 壳、按键命令与各取数服务同生共死：壳管静止计时、全屏记账与离开，按键命令要壳判断这一页还在不在。
 * 山脊图的缓冲跟着频谱取数的帧走，封面底色的源图跟着罗盘那份封面走，所以各排在它们的来源之后。
 * 返回 null 表示这一刻没有在跑的服务（首帧、已经离开）。
 */
export function useImmersiveServices(current: boolean): RunningServices | null {
  const store = useStore();
  const history = useService(historyKey);
  const commands = useService(commandsKey);
  const playback = useService(playbackKey);
  const [running, setRunning] = useState<RunningServices | null>(null);

  useEffect(() => {
    if (!current) return;
    loadPrefsOnce(store);
    const shell = startImmersiveShell(store, {
      history,
      fullscreenOnEnter: () => store.get(immersiveHostFullscreenAtom),
    });
    const cover = startImmersiveCover(store);
    const spectrum = startSpectrumHistory(store, { terrain: immersiveTerrainAtom });
    const terrain = startTerrainHistory(store, spectrum);
    const stereo = startStereoSamples(store, { spectrumStatus: spectrumStatusAtom });
    const services = [
      shell,
      cover,
      startCoverSource(store),
      spectrum,
      terrain,
      stereo,
      startTrackExtras(store),
      startFullWaveform(store),
      startTrackDynamics(store, { source: hostFullRatePcm }),
      startLiveLoudness(store),
      startTrackAnalysis(store, { wanted: ANALYSIS_WANTED, source: hostPcmSource }),
    ];
    const unregister = registerImmersiveCommands(commands, {
      playback,
      store,
      shell,
      togglePerfOverlay: () => togglePerfOverlay(store),
    });
    setRunning({ shell, cover, spectrum, terrain, stereo });
    return () => {
      unregister();
      for (const service of services.reverse()) service.dispose();
      setRunning(null);
    };
  }, [current, store, history, commands, playback]);

  return running;
}
