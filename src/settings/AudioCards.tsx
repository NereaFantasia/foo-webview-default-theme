import {
  DeviceEq20Regular,
  Headphones20Regular,
  SoundWaveCircle20Regular,
  Timer20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  audioSettingsAtom,
  audioSettingsKey,
  BUFFER_RANGE_MS,
  PREAMP_RANGE_DB,
  REPLAYGAIN_PROCESSING,
  REPLAYGAIN_SOURCES,
  type ReplayGainProcessing,
  type ReplayGainSource,
} from '../playback/audioSettings.ts';
import {
  deviceKeyOf,
  outputDevicesAtom,
  outputDevicesKey,
  outputGroupsOf,
} from '../playback/outputDevices.ts';
import { NumberControl, NumberSetting } from './NumberSetting.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';

const SOURCE_LABELS: Readonly<Record<ReplayGainSource, MessageKey>> = {
  none: 'settings.replayGainSourceNone',
  track: 'settings.replayGainSourceTrack',
  album: 'settings.replayGainSourceAlbum',
  auto: 'settings.replayGainSourceAuto',
};

const PROCESSING_LABELS: Readonly<Record<ReplayGainProcessing, MessageKey>> = {
  none: 'settings.replayGainProcessingNone',
  gain: 'settings.replayGainProcessingGain',
  gain_and_peak: 'settings.replayGainProcessingGainAndPeak',
  peak: 'settings.replayGainProcessingPeak',
};

/**
 * 输出设备：与音量浮层里是同一份清单与同一个切换。插拔设备时宿主不发事件，打开设置页时现读一次
 */
export function OutputDeviceCard() {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(outputDevicesAtom);
  const service = useService(outputDevicesKey);
  useEffect(() => service.refresh(), [service]);
  // 设备分属几个输出模块时，下拉列表按模块分组，与音量浮层里一样；只有一个模块就不分
  const modules = outputGroupsOf(state.devices).length;
  const options = state.devices.map((device) => ({
    value: deviceKeyOf(device),
    label: device.name,
    group: modules > 1 ? device.outputName || t('player.outputUnknown') : undefined,
  }));
  let description: string | undefined;
  if (state.status === 'unavailable') description = t('settings.needsHost');
  else if (state.status === 'failed') description = t('player.devicesFailed');
  else if (state.selectFailed) description = t('player.deviceSwitchFailed');
  else if (state.status === 'ready' && state.devices.length === 0)
    description = t('player.devicesEmpty');
  return (
    <SettingsCard
      icon={<Headphones20Regular />}
      title={t('player.outputDevice')}
      field
      description={description}
      error={state.status === 'failed' || state.selectFailed}
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={options}
          value={state.current ? deviceKeyOf(state.current) : ''}
          disabled={state.status !== 'ready' || state.devices.length === 0}
          onChange={(key) => {
            const device = state.devices.find((item) => deviceKeyOf(item) === key);
            if (device) void service.select(device.outputId, device.deviceId);
          }}
        />
      )}
    </SettingsCard>
  );
}

/**
 * ReplayGain：来源、处理与两个前置增益，都是 foobar2000 自己的设置，改了即时生效；在 foobar2000
 * 首选项里改了，宿主会推事件
 */
export function ReplayGainExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(audioSettingsAtom);
  const service = useService(audioSettingsKey);
  const settings = state.replayGain;
  const absent = state.status === 'unavailable';
  // 宿主在、却读不到（没有这个方法）时不出这张卡
  if (!settings && state.status === 'ready') return null;
  const rejected = state.failed.includes('replayGain');
  const description = absent
    ? t('settings.needsHost')
    : rejected
      ? t('settings.replayGainRejected')
      : settings
        ? t('settings.current', { name: t(SOURCE_LABELS[settings.source]) })
        : undefined;
  const disabled = settings === null;
  return (
    <SettingsExpander
      icon={<SoundWaveCircle20Regular />}
      title={t('settings.replayGain')}
      description={description}
      error={absent ? false : rejected}
      defaultOpen={false}
    >
      <SettingsRow title={t('settings.replayGainSource')} field disabled={disabled}>
        {(ids) => (
          <SettingsSelect
            {...ids}
            options={REPLAYGAIN_SOURCES.map((value) => ({
              value,
              label: t(SOURCE_LABELS[value]),
            }))}
            value={settings?.source ?? 'none'}
            disabled={disabled}
            onChange={(source) => void service.setReplayGainModes({ source })}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('settings.replayGainProcessing')} field disabled={disabled}>
        {(ids) => (
          <SettingsSelect
            {...ids}
            options={REPLAYGAIN_PROCESSING.map((value) => ({
              value,
              label: t(PROCESSING_LABELS[value]),
            }))}
            value={settings?.processing ?? 'none'}
            disabled={disabled}
            onChange={(processing) => void service.setReplayGainModes({ processing })}
          />
        )}
      </SettingsRow>
      <NumberSetting
        label={t('settings.replayGainPreampWithRg')}
        value={settings?.preampWithRg ?? 0}
        min={PREAMP_RANGE_DB.min}
        max={PREAMP_RANGE_DB.max}
        step={0.5}
        disabled={disabled}
        onChange={(withRg) => void service.setReplayGainPreamps({ withRg })}
      />
      <NumberSetting
        label={t('settings.replayGainPreampWithoutRg')}
        value={settings?.preampWithoutRg ?? 0}
        min={PREAMP_RANGE_DB.min}
        max={PREAMP_RANGE_DB.max}
        step={0.5}
        disabled={disabled}
        onChange={(withoutRg) => void service.setReplayGainPreamps({ withoutRg })}
      />
    </SettingsExpander>
  );
}

/** DSP 预设：选用一个就换掉整条 DSP 链；宿主没有「不选」，没有预设时不出这张卡 */
export function DspPresetCard() {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(audioSettingsAtom);
  const service = useService(audioSettingsKey);
  const absent = state.status === 'unavailable';
  if (state.status === 'ready' && state.presets.length === 0) return null;
  const rejected = state.failed.includes('preset');
  return (
    <SettingsCard
      icon={<DeviceEq20Regular />}
      title={t('settings.dspPreset')}
      field
      description={
        absent ? t('settings.needsHost') : rejected ? t('settings.dspPresetRejected') : undefined
      }
      error={absent ? false : rejected}
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={state.presets.map((preset) => ({
            value: String(preset.index),
            label: preset.name,
          }))}
          value={state.activePreset === null ? '' : String(state.activePreset)}
          disabled={state.status !== 'ready'}
          onChange={(index) => void service.selectPreset(Number(index))}
        />
      )}
    </SettingsCard>
  );
}

/** 输出缓冲长度：foobar2000 输出设置里的同一项，毫秒；写入夹在 50 到 2000 之间 */
export function OutputBufferCard() {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(audioSettingsAtom);
  const service = useService(audioSettingsKey);
  const absent = state.status === 'unavailable';
  if (state.status === 'ready' && state.bufferMs === null) return null;
  const rejected = state.failed.includes('buffer');
  return (
    <SettingsCard
      icon={<Timer20Regular />}
      title={t('settings.outputBuffer')}
      field
      description={
        absent ? t('settings.needsHost') : rejected ? t('settings.outputBufferRejected') : undefined
      }
      error={absent ? false : rejected}
    >
      {(ids) => (
        <NumberControl
          {...ids}
          value={state.bufferMs ?? BUFFER_RANGE_MS.min}
          min={BUFFER_RANGE_MS.min}
          max={BUFFER_RANGE_MS.max}
          step={50}
          disabled={state.bufferMs === null}
          onChange={(ms) => void service.setBufferMs(ms)}
        />
      )}
    </SettingsCard>
  );
}
