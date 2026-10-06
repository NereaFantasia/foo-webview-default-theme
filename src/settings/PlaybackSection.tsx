import { Speaker220Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  chooseVolumeScale,
  VOLUME_SCALES,
  VOLUME_SCALE_STORAGE_KEY,
  volumeScaleAtom,
  type VolumeScale,
} from '../playback/volumeScale.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';

const SCALE_LABELS: Readonly<Record<VolumeScale, MessageKey>> = {
  perceptual: 'settings.volumeScalePerceptual',
  db: 'settings.volumeScaleDb',
};

/** 「播放」一组：音量条的刻度。只改条上的位置怎么换算，不动 foobar2000 的音量。 */
export function PlaybackSection() {
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
