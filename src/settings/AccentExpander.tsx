import { Button, Switch, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Color20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  chooseCoverAccentEnabled,
  COVER_ACCENT_STORAGE_KEY,
  coverAccentEnabledAtom,
  coverProfileAtom,
} from '../theme/accentState.ts';
import {
  BASE_ACCENT_MODES,
  BASE_ACCENT_STORAGE_KEY,
  baseAccentModeAtom,
  baseAccentSourceAtom,
  chooseBaseAccent,
  refreshWindowsAccent,
  windowsAccentFailedAtom,
  type BaseAccentMode,
} from '../theme/baseAccent.ts';
import { PLAY_BUTTON_STYLES, type PlayButtonStyle } from '../theme/playButtonColors.ts';
import {
  choosePlayButtonStyle,
  PLAY_BUTTON_STYLE_KEY,
  playButtonStyleAtom,
} from '../theme/playButtonStyle.ts';
import styles from './AccentExpander.module.css';
import { CustomAccentPicker } from './CustomAccentPicker.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';

export const BASE_ACCENT_LABELS: Readonly<Record<BaseAccentMode, MessageKey>> = {
  teal: 'settings.accentTeal',
  windows: 'settings.accentWindows',
  custom: 'settings.customAccent',
};

const PLAY_BUTTON_LABELS: Readonly<Record<PlayButtonStyle, MessageKey>> = {
  brand: 'settings.playButtonBrand',
  soft: 'settings.playButtonSoft',
  raw: 'settings.playButtonRaw',
  tonal: 'settings.playButtonTonal',
  neutral: 'settings.playButtonNeutral',
};

/** 强调色此刻取自哪里：跟随封面且这张封面取得出颜色时是封面，否则是基础色的来源。 */
export function useAccentSourceName(): string {
  const t = useAtomValueRawSync(translateAtom);
  const enabled = useAtomValueRawSync(coverAccentEnabledAtom);
  const profile = useAtomValueRawSync(coverProfileAtom);
  const base = useAtomValueRawSync(baseAccentSourceAtom);
  return t(enabled && profile?.accent ? 'settings.accentCover' : BASE_ACCENT_LABELS[base]);
}

/** Windows 强调色读不到时的错误文案；没选 Windows 强调色或读到了时是 undefined。 */
function useWindowsAccentError(): string | undefined {
  const t = useAtomValueRawSync(translateAtom);
  const mode = useAtomValueRawSync(baseAccentModeAtom);
  const failed = useAtomValueRawSync(windowsAccentFailedAtom);
  return failed && mode === 'windows' ? t('settings.windowsAccentFailed') : undefined;
}

function CoverAccentRow() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const enabled = useAtomValueRawSync(coverAccentEnabledAtom);
  return (
    <SettingsRow
      title={t('settings.followCoverAccent')}
      feedback={<LocalSaveNotice keys={[COVER_ACCENT_STORAGE_KEY]} />}
    >
      {({ labelId, descriptionId }) => (
        <Switch
          checked={enabled}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(_, data) => chooseCoverAccentEnabled(store, data.checked)}
        />
      )}
    </SettingsRow>
  );
}

/** 基础强调色：自定义时旁边是取色键，Windows 强调色时旁边是刷新键。 */
function BaseAccentRow() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const mode = useAtomValueRawSync(baseAccentModeAtom);
  const failure = useWindowsAccentError();
  return (
    <SettingsRow
      title={t('settings.baseAccent')}
      feedback={<LocalSaveNotice keys={[BASE_ACCENT_STORAGE_KEY]} />}
      description={failure}
      error={failure !== undefined}
      field
    >
      {(ids) => (
        <div className={styles.controls}>
          <SettingsSelect
            {...ids}
            options={BASE_ACCENT_MODES.map((value) => ({
              value,
              label: t(BASE_ACCENT_LABELS[value]),
            }))}
            value={mode}
            onChange={(value) => chooseBaseAccent(store, value)}
          />
          {mode === 'custom' && <CustomAccentPicker />}
          {mode === 'windows' && (
            <Tooltip content={t('settings.refreshWindowsAccent')} relationship="label">
              <Button
                icon={<ArrowClockwise20Regular />}
                aria-label={t('settings.refreshWindowsAccent')}
                onClick={() => refreshWindowsAccent(store)}
              />
            </Tooltip>
          )}
        </div>
      )}
    </SettingsRow>
  );
}

function PlayButtonRow() {
  const t = useAtomValueRawSync(translateAtom);
  const style = useAtomValueRawSync(playButtonStyleAtom);
  const store = useStore();
  return (
    <SettingsRow
      title={t('settings.playButtonStyle')}
      feedback={<LocalSaveNotice keys={[PLAY_BUTTON_STYLE_KEY]} />}
      field
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={PLAY_BUTTON_STYLES.map((value) => ({
            value,
            label: t(PLAY_BUTTON_LABELS[value]),
          }))}
          value={style}
          onChange={(value) => choosePlayButtonStyle(store, value)}
        />
      )}
    </SettingsRow>
  );
}

/**
 * 强调色：卡头写此刻取自哪里，箭头前的色块是此刻的强调色。子行是跟随封面、基础色与主播放按钮的配色；
 * Windows 强调色读不到时，卡头与基础色那一行写同一条错误。
 */
export function AccentExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const source = useAccentSourceName();
  const failure = useWindowsAccentError();
  return (
    <SettingsExpander
      icon={<Color20Regular />}
      title={t('settings.accent')}
      description={failure ?? t('settings.current', { name: source })}
      error={failure !== undefined}
      preview={<span className={styles.swatch} />}
      defaultOpen={false}
    >
      <CoverAccentRow />
      <BaseAccentRow />
      <PlayButtonRow />
    </SettingsExpander>
  );
}
