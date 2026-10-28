import { atom, type Atom } from 'jotai/vanilla';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useEffect, useState } from 'react';
import { hostFullRatePcm, hostPcmSource } from '../immersive/analysis/hostPcmSource.ts';
import { startTrackAnalysis } from '../immersive/analysis/trackAnalysis.ts';
import { immersiveCoverKey, startImmersiveCover } from '../covers/immersiveCover.ts';
import { trackArtworkKey } from '../covers/trackArtwork.ts';
import { startTrackExtras } from '../immersive/fields/trackExtras.ts';
import { startLiveLoudness } from '../immersive/gauges/liveLoudness.ts';
import { startTrackDynamics } from '../immersive/gauges/trackDynamics.ts';
import {
  createLeaseRegistry,
  leaseBinding,
  type LeaseRegistry,
} from '../immersive/lease/leaseRegistry.ts';
import { NowPlayingPage } from '../immersive/page/NowPlayingPage.tsx';
import {
  immersiveSceneAtom,
  immersiveTerrainAtom,
  waveformModeAtom,
  type ImmersiveScene,
} from '../immersive/page/immersivePrefs.ts';
import type { ImmersiveShell } from '../immersive/page/immersiveShell.ts';
import type { ViewServices } from '../immersive/page/viewServices.ts';
import { sceneTierAtom } from '../immersive/paper/sceneTier.ts';
import { spectrumStatusAtom, startSpectrumHistory } from '../immersive/spectrum/spectrumHistory.ts';
import { startStereoSamples } from '../immersive/stereo/stereoSamples.ts';
import { startTerrainHistory } from '../immersive/terrain/terrainHistory.ts';
import { startCoverSource } from '../immersive/wash/coverSource.ts';
import { startFullWaveform } from '../immersive/waveform/fullWaveform.ts';
import { needsBands } from '../immersive/waveform/waveformModes.ts';
import type { Store } from '../kit/store.ts';
import { useService } from '../kit/useService.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';
import { playbackKey } from '../playback/playbackContract.ts';
import { immersiveIntegrationKey } from './immersiveIntegration.ts';
import { initializeImmersivePrefs } from './immersivePrefs.ts';

// 分频画法和完整舞台的拍点共用解码；档位未确定时不提前为舞台启动分析
const ANALYSIS_WANTED = atom(
  (get) => needsBands(get(waveformModeAtom)) || get(sceneTierAtom) === 'full',
);
const INACTIVE = atom(false);

interface RunningView {
  readonly shell: ImmersiveShell;
  readonly services: ViewServices;
  /** 这一轮结束（离开这一页、换场景）时登记处随即释放，之后置为 null：退场还没播完又前进回来的第一帧不能再借已释放的 */
  readonly leases: LeaseRegistry | null;
  /** 这一轮是为哪个场景起的；换场景的第一帧里它已经释放，不能再交给新场景借 */
  readonly scene: ImmersiveScene;
}

/** 图纸场景的取数服务：只有这个场景在画时才起，换了场景随即停 */
function startPaperResources(store: Store, active: Atom<boolean>) {
  const wanted = atom((get) => get(active) && get(ANALYSIS_WANTED));
  const spectrum = startSpectrumHistory(store, {
    terrain: immersiveTerrainAtom,
    visibility: {
      hidden: () => !store.get(active),
      subscribe: (listener) => store.sub(active, listener),
    },
  });
  const terrain = startTerrainHistory(store, spectrum);
  const stereo = startStereoSamples(store, { spectrumStatus: spectrumStatusAtom, active });
  const resources = [
    spectrum,
    terrain,
    stereo,
    startFullWaveform(store, { active }),
    startTrackDynamics(store, { source: hostFullRatePcm, active }),
    startLiveLoudness(store, { active }),
    startTrackAnalysis(store, { wanted, source: hostPcmSource }),
  ];
  return {
    view: { spectrum, terrain, stereo },
    dispose() {
      const errors: unknown[] = [];
      for (const service of [...resources].reverse()) {
        try {
          service.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, '沉浸取数清理失败');
    },
  };
}

/**
 * 沉浸视图主页面装配容器
 *
 * 核心渲染模块按需动态导入；取数服务绑定具体场景生命周期：图纸场景启用专用取数服务，
 * 预设场景通过租约调度中心按需申请；全屏状态管理与外壳交互在场景切换期间保持稳定
 */
export function ImmersivePage() {
  const store = useStore();
  const entry = useContext(PageEntryContext);
  const current = useAtomValueRawSync(historyAtom).entry === entry;
  const integration = useService(immersiveIntegrationKey);
  const playback = useService(playbackKey);
  const artwork = useService(trackArtworkKey);
  // 场景偏好在解析场景前同步加载至 store（单次幂等初始化）
  initializeImmersivePrefs(store);
  const scene = useAtomValueRawSync(immersiveSceneAtom);
  const [running, setRunning] = useState<RunningView | null>(null);

  useEffect(() => {
    if (!current || !entry) return;
    const paper = scene === 'paper';
    const session = integration.enter(
      entry,
      paper ? (active) => startPaperResources(store, active) : null,
    );
    if (!session) return;
    const leases = createLeaseRegistry([
      leaseBinding(immersiveCoverKey, () => startImmersiveCover(store, { artwork })),
    ]);
    const services: { dispose(): void }[] = [];
    let view: ViewServices;
    if (paper) {
      if (!session.resources) return;
      const cover = startImmersiveCover(store, { artwork });
      services.push(cover, startCoverSource(store), startTrackExtras(store));
      view = {
        playback,
        cover,
        ...session.resources.view,
        active: session.active,
        visible: integration.visible,
      };
    } else {
      view = {
        playback,
        cover: null,
        spectrum: null,
        terrain: null,
        stereo: null,
        active: session.active,
        visible: integration.visible,
      };
    }
    setRunning({ shell: session.shell, services: view, leases, scene });
    return () => {
      for (const service of services.reverse()) service.dispose();
      leases.dispose();
      setRunning((last) => (last?.leases === leases ? { ...last, leases: null } : last));
    };
  }, [current, entry, scene, store, integration, playback, artwork]);

  return (
    <NowPlayingPage
      current={current}
      shell={current ? (running?.shell ?? null) : null}
      leases={current && running?.scene === scene ? running.leases : null}
      services={
        running?.services ?? {
          active: INACTIVE,
          visible: integration.visible,
          playback,
          cover: null,
          spectrum: null,
          terrain: null,
          stereo: null,
        }
      }
    />
  );
}
