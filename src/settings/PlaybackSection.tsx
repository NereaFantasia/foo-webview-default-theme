import { Speaker220Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { audioSettingsKey } from '../playback/audioSettings.ts';
import {
  chooseVolumeScale,
  VOLUME_SCALES,
  VOLUME_SCALE_STORAGE_KEY,
  volumeScaleAtom,
  type VolumeScale,
} from '../playback/volumeScale.ts';
import {
  DspPresetCard,
  OutputBufferCard,
  OutputDeviceCard,
  ReplayGainExpander,
} from './AudioCards.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsSubheading } from './SettingsSubheading.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';

const SCALE_LABELS: Readonly<Record<VolumeScale, MessageKey>> = {
  perceptual: 'settings.volumeScalePerceptual',
  db: 'settings.volumeScaleDb',
};

/** 音量条的刻度。只改条上的位置怎么换算，不动 foobar2000 的音量 */
function VolumeScaleCard() {
  const t = useAtomValueRawSync(translateAtom);
  const scale = useAtomValueRawSync(volumeScaleAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<Speaker220Regular />}
      title={t('settings.volumeScale')}
      field
      feedback={<LocalSaveNotice keys={[VOLUME_SCALE_STORAGE_KEY]} />}
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={VOLUME_SCALES.map((value) => ({ value, label: t(SCALE_LABELS[value]) }))}
          value={scale}
          onChange={(value) => chooseVolumeScale(store, value)}
        />
      )}
    </SettingsCard>
  );
}

/**
 * 「播放」一组：声音相关的设置。输出设备、ReplayGain、DSP 预设与输出缓冲是 foobar2000 自己的设置，改了
 * 即时生效；音量刻度只改音量条上的换算
 */
export function PlaybackSection() {
  const t = useAtomValueRawSync(translateAtom);
  const audio = useService(audioSettingsKey);
  // 输出缓冲宿主不发变更事件：每次打开这一区现读一次
  useEffect(() => audio.refresh(), [audio]);
  return (
    <>
      <SettingsSubheading>{t('settings.subOutput')}</SettingsSubheading>
      <OutputDeviceCard />
      <OutputBufferCard />
      <DspPresetCard />
      <SettingsSubheading>{t('settings.subVolume')}</SettingsSubheading>
      <ReplayGainExpander />
      <VolumeScaleCard />
    </>
  );
}
