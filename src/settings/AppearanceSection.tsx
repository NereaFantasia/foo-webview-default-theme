import { Switch } from '@fluentui/react-components';
import { Color20Regular, DarkTheme20Regular, PanelBottom20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  choosePlayerBarStyle,
  PLAYER_BAR_STYLES,
  PLAYER_BAR_STORAGE_KEY,
  playerBarStyleAtom,
  type PlayerBarStyle,
} from '../theme/playerBarStyle.ts';
import {
  chooseCoverAccentEnabled,
  coverAccentEnabledAtom,
  COVER_ACCENT_STORAGE_KEY,
} from '../theme/accentState.ts';
import {
  chooseColorMode,
  COLOR_MODES,
  COLOR_MODE_STORAGE_KEY,
  colorModeAtom,
  colorSchemeAtom,
  type ColorMode,
} from '../theme/colorScheme.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { AccentExpander, useAccentSourceName } from './AccentExpander.tsx';
import { BackdropExpander } from './BackdropExpander.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';

const MODE_LABELS: Readonly<Record<ColorMode, MessageKey>> = {
  system: 'settings.colorModeSystem',
  light: 'settings.colorModeLight',
  dark: 'settings.colorModeDark',
};

const STYLE_LABELS: Readonly<Record<PlayerBarStyle, MessageKey>> = {
  bottom: 'settings.playerBarBottom',
  titlebar: 'settings.playerBarTitlebar',
  capsule: 'settings.playerBarCapsule',
};

/** 深浅模式。跟随系统时说明行写出此刻实际是哪一档；手选了一档就不必再写。 */
export function ColorModeCard() {
  const t = useAtomValueRawSync(translateAtom);
  const mode = useAtomValueRawSync(colorModeAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<DarkTheme20Regular />}
      title={t('settings.colorMode')}
      feedback={<LocalSaveNotice keys={[COLOR_MODE_STORAGE_KEY]} />}
      description={
        mode === 'system' ? t('settings.current', { name: t(MODE_LABELS[scheme]) }) : undefined
      }
      field
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={COLOR_MODES.map((value) => ({ value, label: t(MODE_LABELS[value]) }))}
          value={mode}
          onChange={(value) => chooseColorMode(store, value)}
        />
      )}
    </SettingsCard>
  );
}

/** 播放栏放在窗口底部、标题栏里，还是浮在内容卡底部的胶囊，换了即时生效。 */
function PlayerBarCard() {
  const t = useAtomValueRawSync(translateAtom);
  const style = useAtomValueRawSync(playerBarStyleAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<PanelBottom20Regular />}
      title={t('settings.playerBar')}
      field
      feedback={<LocalSaveNotice keys={[PLAYER_BAR_STORAGE_KEY]} />}
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={PLAYER_BAR_STYLES.map((value) => ({ value, label: t(STYLE_LABELS[value]) }))}
          value={style}
          onChange={(value) => choosePlayerBarStyle(store, value)}
        />
      )}
    </SettingsCard>
  );
}

/** 跟随封面取色单独成卡，说明行写此刻取自哪里；新人引导用，设置页里它是强调色卡的一行。 */
export function CoverAccentCard() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const enabled = useAtomValueRawSync(coverAccentEnabledAtom);
  const source = useAccentSourceName();
  return (
    <SettingsCard
      icon={<Color20Regular />}
      title={t('settings.followCoverAccent')}
      feedback={<LocalSaveNotice keys={[COVER_ACCENT_STORAGE_KEY]} />}
      description={t('settings.current', { name: source })}
    >
      {({ labelId, descriptionId }) => (
        <Switch
          checked={enabled}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(_, data) => chooseCoverAccentEnabled(store, data.checked)}
        />
      )}
    </SettingsCard>
  );
}

/** 外观偏好即时生效；本地颜色偏好在未连接宿主时也能修改。 */
export function AppearanceSection() {
  return (
    <>
      <ColorModeCard />
      <AccentExpander />
      <BackdropExpander />
      <PlayerBarCard />
    </>
  );
}
