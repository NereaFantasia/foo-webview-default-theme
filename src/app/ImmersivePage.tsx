import { atom } from 'jotai/vanilla';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useEffect, useState } from 'react';
import { hostFullRatePcm, hostPcmSource } from '../immersive/analysis/hostPcmSource.ts';
import { startTrackAnalysis } from '../immersive/analysis/trackAnalysis.ts';
import { startImmersiveCover } from '../immersive/cover/immersiveCover.ts';
import { startTrackExtras } from '../immersive/fields/trackExtras.ts';
import { startLiveLoudness } from '../immersive/gauges/liveLoudness.ts';
import { startTrackDynamics } from '../immersive/gauges/trackDynamics.ts';
import { NowPlayingPage } from '../immersive/page/NowPlayingPage.tsx';
import { immersiveTerrainAtom, waveformModeAtom } from '../immersive/page/immersivePrefs.ts';
import type { ImmersiveShell } from '../immersive/page/immersiveShell.ts';
import type { ViewServices } from '../immersive/page/viewServices.ts';
import { sceneTierAtom } from '../immersive/paper/sceneTier.ts';
import { spectrumStatusAtom, startSpectrumHistory } from '../immersive/spectrum/spectrumHistory.ts';
import { startStereoSamples } from '../immersive/stereo/stereoSamples.ts';
import { startTerrainHistory } from '../immersive/terrain/terrainHistory.ts';
import { startCoverSource } from '../immersive/wash/coverSource.ts';
import { startFullWaveform } from '../immersive/waveform/fullWaveform.ts';
import { needsBands } from '../immersive/waveform/waveformModes.ts';
import { useService } from '../kit/useService.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { PageEntryContext } from '../nav/usePageSnapshot.ts';
import { playbackKey } from '../playback/playbackContract.ts';
import { immersiveIntegrationKey } from './immersiveIntegration.ts';

// 分频画法和完整舞台的拍点共用解码；档位未确定时不提前为舞台启动分析。
const ANALYSIS_WANTED = atom(
  (get) => needsBands(get(waveformModeAtom)) || get(sceneTierAtom) === 'full',
);
const INACTIVE = atom(false);

interface RunningView {
  readonly shell: ImmersiveShell;
  readonly services: ViewServices;
}

/** 昂贵模块随页面加载；应用持有取数服务，组件各自管理 canvas 及其绘制资源。 */
export function ImmersivePage() {
  const store = useStore();
  const entry = useContext(PageEntryContext);
  const current = useAtomValueRawSync(historyAtom).entry === entry;
  const integration = useService(immersiveIntegrationKey);
  const playback = useService(playbackKey);
  const [running, setRunning] = useState<RunningView | null>(null);

  useEffect(() => {
    if (!current || !entry) return;
    const session = integration.enter(entry, (active) => {
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
    });
    if (!session?.resources) return;
    const cover = startImmersiveCover(store);
    const services = [cover, startCoverSource(store), startTrackExtras(store)];
    setRunning({
      shell: session.shell,
      services: {
        playback,
        cover,
        ...session.resources.view,
        active: session.active,
        visible: integration.visible,
      },
    });
    return () => {
      for (const service of services.reverse()) service.dispose();
    };
  }, [current, entry, store, integration, playback]);

  return (
    <NowPlayingPage
      current={current}
      shell={current ? (running?.shell ?? null) : null}
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
