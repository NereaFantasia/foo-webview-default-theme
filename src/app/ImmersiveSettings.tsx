import { Switch } from '@fluentui/react-components';
import {
  FullScreenMaximize20Regular,
  Image20Regular,
  Gauge20Regular,
  SoundWaveCircle20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useLayoutEffect, useState } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  chooseImmersiveFpsCap,
  chooseImmersiveHostFullscreen,
  chooseImmersiveTerrain,
  chooseImmersiveWash,
  chooseWaveformMode,
  FPS_CAPS,
  immersiveFpsCapAtom,
  immersiveHostFullscreenAtom,
  immersiveTerrainAtom,
  immersiveWashAtom,
  IMMERSIVE_PREF_KEYS,
  WASH_CHOICES,
  waveformModeAtom,
  type WashChoice,
} from '../immersive/page/immersivePrefs.ts';
import {
  choosePerfOverlay,
  perfOverlayEnabledAtom,
  PERF_OVERLAY_STORAGE_KEY,
} from '../immersive/perf/perfOverlay.ts';
import { WAVEFORM_MODES, type WaveformMode } from '../immersive/waveform/waveformModes.ts';
import { SettingsCard } from '../settings/SettingsCard.tsx';
import { SettingsExpander } from '../settings/SettingsExpander.tsx';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { SettingsSelect } from '../settings/SettingsSelect.tsx';
import { LocalSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { initializeImmersivePrefs } from './immersivePrefs.ts';

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

/** 设置插槽只加载偏好；进入沉浸视图时仍由对应页面建立资源与全屏控制。 */
export function ImmersiveSettings() {
  const store = useStore();
  const [ready, setReady] = useState(false);
  const t = useAtomValueRawSync(translateAtom);
  const fullscreen = useAtomValueRawSync(immersiveHostFullscreenAtom);
  const wash = useAtomValueRawSync(immersiveWashAtom);
  const terrain = useAtomValueRawSync(immersiveTerrainAtom);
  const waveform = useAtomValueRawSync(waveformModeAtom);
  const fps = useAtomValueRawSync(immersiveFpsCapAtom);
  const overlay = useAtomValueRawSync(perfOverlayEnabledAtom);
  useLayoutEffect(() => {
    initializeImmersivePrefs(store);
    setReady(true);
  }, [store]);
  if (!ready) return null;
  return (
    <>
      <SettingsCard
        icon={<FullScreenMaximize20Regular />}
        title={t('settings.immersiveFullscreen')}
        feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.hostFullscreen]} />}
      >
        {({ labelId, descriptionId }) => (
          <Switch
            checked={fullscreen}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            onChange={(_, data) => chooseImmersiveHostFullscreen(store, data.checked)}
          />
        )}
      </SettingsCard>
      <SettingsExpander
        icon={<Image20Regular />}
        title={t('settings.immersiveBackground')}
        defaultOpen={false}
        feedback={
          <LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.wash, IMMERSIVE_PREF_KEYS.terrain]} />
        }
      >
        <SettingsRow title={t('settings.immersiveWash')} field>
          {(ids) => (
            <SettingsSelect
              {...ids}
              value={wash}
              options={WASH_CHOICES.map((value) => ({ value, label: t(WASH_LABELS[value]) }))}
              onChange={(value) => chooseImmersiveWash(store, value)}
            />
          )}
        </SettingsRow>
        <SettingsRow title={t('settings.immersiveTerrain')}>
          {({ labelId, descriptionId }) => (
            <Switch
              checked={terrain}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onChange={(_, data) => chooseImmersiveTerrain(store, data.checked)}
            />
          )}
        </SettingsRow>
      </SettingsExpander>
      <SettingsCard
        icon={<SoundWaveCircle20Regular />}
        title={t('immersive.waveformMode')}
        field
        feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.waveformMode]} />}
      >
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={waveform}
            options={WAVEFORM_MODES.map((value) => ({ value, label: t(WAVEFORM_LABELS[value]) }))}
            onChange={(value) => chooseWaveformMode(store, value)}
          />
        )}
      </SettingsCard>
      <SettingsExpander
        icon={<Gauge20Regular />}
        title={t('settings.immersivePerformance')}
        defaultOpen={false}
        feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.fpsCap, PERF_OVERLAY_STORAGE_KEY]} />}
      >
        <SettingsRow title={t('settings.immersiveFps')} field>
          {(ids) => (
            <SettingsSelect
              {...ids}
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
          )}
        </SettingsRow>
        <SettingsRow title={t('settings.immersivePerfOverlay')}>
          {({ labelId, descriptionId }) => (
            <Switch
              checked={overlay}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onChange={(_, data) => choosePerfOverlay(store, data.checked)}
            />
          )}
        </SettingsRow>
      </SettingsExpander>
    </>
  );
}
