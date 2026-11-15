import { Switch } from '@fluentui/react-components';
import { PanelBottom20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  choosePlayerBarStyle,
  chooseCapsuleBlur,
  capsuleBlurAtom,
  CAPSULE_BLUR_STORAGE_KEY,
  PLAYER_BAR_STYLES,
  PLAYER_BAR_STORAGE_KEY,
  playerBarStyleAtom,
  type PlayerBarStyle,
} from '../theme/playerBarStyle.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsChoice, type SettingsChoiceOption } from './SettingsChoice.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { MiniWindow } from './thumbnails/MiniWindow.tsx';

const STYLE_LABELS: Readonly<Record<PlayerBarStyle, MessageKey>> = {
  bottom: 'settings.playerBarBottom',
  titlebar: 'settings.playerBarTitlebar',
  capsule: 'settings.playerBarCapsule',
};

/** 播放栏位置的三张缩略图单选项；设置页与新人引导共用 */
export function usePlayerBarOptions(): readonly SettingsChoiceOption<PlayerBarStyle>[] {
  const t = useAtomValueRawSync(translateAtom);
  return PLAYER_BAR_STYLES.map((value) => ({
    value,
    label: t(STYLE_LABELS[value]),
    preview: <MiniWindow bar={value} />,
  }));
}

/** 播放栏放在窗口底部、标题栏里，还是浮在内容卡底部的胶囊，换了即时生效 */
export function PlayerBarCard() {
  const t = useAtomValueRawSync(translateAtom);
  const style = useAtomValueRawSync(playerBarStyleAtom);
  const blur = useAtomValueRawSync(capsuleBlurAtom);
  const options = usePlayerBarOptions();
  const store = useStore();
  return (
    <SettingsCard
      icon={<PanelBottom20Regular />}
      title={t('settings.playerBar')}
      block
      feedback={<LocalSaveNotice keys={[PLAYER_BAR_STORAGE_KEY, CAPSULE_BLUR_STORAGE_KEY]} />}
      footer={
        style !== 'bottom' && (
          <SettingsRow title={t('settings.capsuleBlur')}>
            {({ labelId }) => (
              <Switch
                checked={blur}
                aria-labelledby={labelId}
                onChange={(_, data) => chooseCapsuleBlur(store, data.checked)}
              />
            )}
          </SettingsRow>
        )
      }
    >
      {(ids) => (
        <SettingsChoice
          {...ids}
          options={options}
          value={style}
          onChange={(value) => choosePlayerBarStyle(store, value)}
        />
      )}
    </SettingsCard>
  );
}
