import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { ONLINE_ANALYSIS_CHOICES, type OnlineAnalysis } from '../../host/onlineAnalysis.ts';
import { colorSchemeAtom } from '../../theme/colorScheme.ts';
import { backdropChoiceAtom, chooseBackdrop } from '../backdrop/backdropState.ts';
import type { BackdropChoice } from '../backdrop/backdropChoice.ts';
import { choosePerfOverlay, perfOverlayEnabledAtom } from '../perf/perfOverlay.ts';
import { BackdropThumb, SceneThumb } from '../thumbnails/ViewThumbs.tsx';
import { WaveformThumb } from '../thumbnails/WaveformThumb.tsx';
import { WAVEFORM_MODES, type WaveformMode } from '../waveform/waveformModes.ts';
import { ChoiceCards } from './ChoiceCards.tsx';
import {
  FPS_CAPS,
  IMMERSIVE_SCENES,
  WASH_CHOICES,
  chooseImmersiveFpsCap,
  chooseImmersiveHostFullscreen,
  chooseImmersiveScene,
  chooseImmersiveTerrain,
  chooseImmersiveWash,
  chooseOnlineAnalysis,
  chooseWaveformMode,
  immersiveFpsCapAtom,
  immersiveHostFullscreenAtom,
  immersiveSceneAtom,
  immersiveTerrainAtom,
  immersiveWashAtom,
  onlineAnalysisAtom,
  waveformModeAtom,
  type ImmersiveScene,
  type WashChoice,
} from './immersivePrefs.ts';
import { SettingsGroup, SelectRow, SwitchRow } from './SettingsRows.tsx';

// 设置编辑里两种场景共用的几块。读写的都是设置页那一组偏好，两边改了互相看得到

/** 编辑卡片里只有这一组时不画小标题 */
interface SectionProps {
  readonly titled?: boolean;
}

const SCENE_LABELS: Readonly<Record<ImmersiveScene, MessageKey>> = {
  paper: 'settings.immersiveScenePaper',
  presets: 'settings.immersiveScenePresets',
};

const BACKDROP_LABELS: Readonly<Record<BackdropChoice, MessageKey>> = {
  mesh: 'settings.immersiveBackdropMesh',
  titanium: 'settings.immersiveBackdropTitanium',
  isolation: 'settings.immersiveBackdropIsolation',
  flow: 'settings.backgroundPalette',
  off: 'settings.immersiveBackdropOff',
};

/** 卡片里的先后：缺省的网格渐变排第一，纯色排最后 */
const BACKDROP_ORDER: readonly BackdropChoice[] = ['mesh', 'flow', 'titanium', 'isolation', 'off'];

const WASH_LABELS: Readonly<Record<WashChoice, MessageKey>> = {
  flow: 'settings.immersiveWashFlow',
  static: 'settings.immersiveWashStatic',
  off: 'settings.immersiveWashOff',
};

const WAVEFORM_LABELS: Readonly<Record<WaveformMode, MessageKey>> = {
  rms: 'immersive.waveformRms',
  weighted: 'immersive.waveformWeighted',
  midHigh: 'immersive.waveformMidHigh',
  layers: 'immersive.waveformLayers',
  lanes: 'immersive.waveformLanes',
};

const ONLINE_ANALYSIS_LABELS: Readonly<Record<OnlineAnalysis, MessageKey>> = {
  hold: 'settings.immersiveOnlineAnalysisHold',
  segments: 'settings.immersiveOnlineAnalysisSegments',
  off: 'settings.immersiveOnlineAnalysisOff',
};

/** 视图样式：图纸与歌词两张缩略图，点中就换场景 */
export function ViewStyleSection({ titled = true }: SectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const scene = useAtomValueRawSync(immersiveSceneAtom);
  const dark = useAtomValueRawSync(colorSchemeAtom) === 'dark';
  const title = t('settings.immersiveScene');
  return (
    <SettingsGroup title={title} titled={titled}>
      <ChoiceCards
        label={title}
        value={scene}
        options={IMMERSIVE_SCENES.map((value) => ({
          value,
          label: t(SCENE_LABELS[value]),
          preview: <SceneThumb scene={value} dark={dark} />,
        }))}
        onChange={(value) => chooseImmersiveScene(store, value)}
      />
    </SettingsGroup>
  );
}

/** 歌词场景的背景渲染器：看图选 */
export function BackdropSection({ titled = true }: SectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const backdrop = useAtomValueRawSync(backdropChoiceAtom);
  const title = t('settings.immersiveBackground');
  return (
    <SettingsGroup title={title} titled={titled}>
      <ChoiceCards
        label={title}
        value={backdrop}
        options={BACKDROP_ORDER.map((value) => ({
          value,
          label: t(BACKDROP_LABELS[value]),
          preview: <BackdropThumb choice={value} />,
        }))}
        onChange={(value) => chooseBackdrop(store, value)}
      />
    </SettingsGroup>
  );
}

/** 图纸场景的背景：封面底色与背景山脊图 */
export function PaperBackgroundSection({ titled = true }: SectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const wash = useAtomValueRawSync(immersiveWashAtom);
  const terrain = useAtomValueRawSync(immersiveTerrainAtom);
  return (
    <SettingsGroup title={t('settings.immersiveBackground')} titled={titled}>
      <SelectRow
        label={t('settings.immersiveWash')}
        value={wash}
        options={WASH_CHOICES.map((value) => ({ value, label: t(WASH_LABELS[value]) }))}
        onChange={(value) => {
          const chosen = WASH_CHOICES.find((choice) => choice === value);
          if (chosen) chooseImmersiveWash(store, chosen);
        }}
      />
      <SwitchRow
        label={t('settings.immersiveTerrain')}
        checked={terrain}
        onChange={(checked) => chooseImmersiveTerrain(store, checked)}
      />
    </SettingsGroup>
  );
}

/** 图纸场景的整轨波形画法与在线曲目的整轨分析 */
export function WaveformSection({ titled = true }: SectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const waveform = useAtomValueRawSync(waveformModeAtom);
  const analysis = useAtomValueRawSync(onlineAnalysisAtom);
  const title = t('immersive.waveformMode');
  return (
    <SettingsGroup title={title} titled={titled}>
      <ChoiceCards
        label={title}
        value={waveform}
        options={WAVEFORM_MODES.map((value) => ({
          value,
          label: t(WAVEFORM_LABELS[value]),
          preview: <WaveformThumb mode={value} />,
        }))}
        onChange={(value) => chooseWaveformMode(store, value)}
      />
      <SelectRow
        label={t('settings.immersiveOnlineAnalysis')}
        value={analysis}
        options={ONLINE_ANALYSIS_CHOICES.map((value) => ({
          value,
          label: t(ONLINE_ANALYSIS_LABELS[value]),
        }))}
        onChange={(value) => {
          const chosen = ONLINE_ANALYSIS_CHOICES.find((choice) => choice === value);
          if (chosen) chooseOnlineAnalysis(store, chosen);
        }}
      />
    </SettingsGroup>
  );
}

/** 进视图时全屏、重画帧率上限、性能小窗 */
export function PerformanceSection({ titled = true }: SectionProps) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const fullscreen = useAtomValueRawSync(immersiveHostFullscreenAtom);
  const fps = useAtomValueRawSync(immersiveFpsCapAtom);
  const overlay = useAtomValueRawSync(perfOverlayEnabledAtom);
  return (
    <SettingsGroup title={t('settings.immersivePerformance')} titled={titled}>
      <SwitchRow
        label={t('settings.immersiveFullscreen')}
        checked={fullscreen}
        onChange={(checked) => chooseImmersiveHostFullscreen(store, checked)}
      />
      <SelectRow
        label={t('settings.immersiveFps')}
        value={String(fps)}
        options={FPS_CAPS.map((value) => ({
          value: String(value),
          label: value === 0 ? t('settings.immersiveFpsUnlimited') : `${value} fps`,
        }))}
        onChange={(value) => {
          const chosen = FPS_CAPS.find((cap) => String(cap) === value);
          if (chosen !== undefined) chooseImmersiveFpsCap(store, chosen);
        }}
      />
      <SwitchRow
        label={t('settings.immersivePerfOverlay')}
        checked={overlay}
        onChange={(checked) => choosePerfOverlay(store, checked)}
      />
    </SettingsGroup>
  );
}
