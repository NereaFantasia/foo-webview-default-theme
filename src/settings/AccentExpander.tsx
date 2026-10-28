import { Button, Switch, Tooltip, tokens } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Color20Regular } from '@fluentui/react-icons';
import { hexFromArgb, TonalPalette } from '@material/material-color-utilities';
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
  chooseCustomAccent,
  customAccentAtom,
  refreshWindowsAccent,
  windowsAccentFailedAtom,
  type BaseAccentMode,
} from '../theme/baseAccent.ts';
import { tealBrand } from '../theme/brand.ts';
import { PLAY_BUTTON_STYLES, type PlayButtonStyle } from '../theme/playButtonColors.ts';
import {
  choosePlayButtonStyle,
  PLAY_BUTTON_STYLE_KEY,
  playButtonStyleAtom,
} from '../theme/playButtonStyle.ts';
import styles from './AccentExpander.module.css';
import { ColorPicker } from './ColorPicker.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsChoice } from './SettingsChoice.tsx';
import { SettingsSegmented } from './SettingsSegmented.tsx';
import { PlayButtonThumb } from './thumbnails/PlayButtonThumb.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';

export const BASE_ACCENT_LABELS: Readonly<Record<BaseAccentMode, MessageKey>> = {
  teal: 'settings.accentTeal',
  windows: 'settings.accentWindows',
  custom: 'settings.customAccent',
};

/** 自定义强调色的预设：品牌青绿加八个色相的中明度色 */
const ACCENT_COLORS = [
  tealBrand[100],
  ...[20, 50, 90, 150, 200, 250, 290, 340].map((hue) =>
    hexFromArgb(TonalPalette.fromHueAndChroma(hue, 48).tone(65)),
  ),
];

const PLAY_BUTTON_LABELS: Readonly<Record<PlayButtonStyle, MessageKey>> = {
  brand: 'settings.playButtonBrand',
  soft: 'settings.playButtonSoft',
  raw: 'settings.playButtonRaw',
  tonal: 'settings.playButtonTonal',
  neutral: 'settings.playButtonNeutral',
};

/** 强调色此刻取自哪里：跟随封面且这张封面取得出颜色时是封面，否则是基础色的来源 */
export function useAccentSourceName(): string {
  const t = useAtomValueRawSync(translateAtom);
  const enabled = useAtomValueRawSync(coverAccentEnabledAtom);
  const profile = useAtomValueRawSync(coverProfileAtom);
  const base = useAtomValueRawSync(baseAccentSourceAtom);
  return t(enabled && profile?.accent ? 'settings.accentCover' : BASE_ACCENT_LABELS[base]);
}

/** Windows 强调色读不到时的错误文案；没选 Windows 强调色或读到了时是 undefined */
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

/** 基础强调色：自定义时旁边是取色键，Windows 强调色时旁边是刷新键 */
function BaseAccentRow() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const mode = useAtomValueRawSync(baseAccentModeAtom);
  const custom = useAtomValueRawSync(customAccentAtom);
  const failure = useWindowsAccentError();
  // Windows 的强调色要等宿主答，色点先用它的缺省蓝
  const dots: Readonly<Record<BaseAccentMode, string>> = {
    teal: tealBrand[100],
    windows: tokens.colorPaletteBlueBorderActive,
    custom,
  };
  return (
    <SettingsRow
      title={t('settings.baseAccent')}
      feedback={<LocalSaveNotice keys={[BASE_ACCENT_STORAGE_KEY]} />}
      description={failure}
      error={failure !== undefined}
      field
    >
      {() => (
        <div className={styles.controls}>
          <SettingsSegmented
            label={t('settings.baseAccent')}
            options={BASE_ACCENT_MODES.map((value) => ({
              value,
              label: t(BASE_ACCENT_LABELS[value]),
              icon: <span className={styles.dot} style={{ backgroundColor: dots[value] }} />,
            }))}
            value={mode}
            onChange={(value) => chooseBaseAccent(store, value)}
          />
          {mode === 'custom' && (
            <ColorPicker
              value={custom}
              label={t('settings.customAccent')}
              colors={ACCENT_COLORS}
              onChange={(color) => chooseCustomAccent(store, color)}
            />
          )}
          {mode === 'windows' && (
            <Tooltip content={t('settings.refreshWindowsAccent')} relationship="label">
              <Button
                appearance="subtle"
                className={viewControls.icon}
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
      block
    >
      {(ids) => (
        <SettingsChoice
          {...ids}
          options={PLAY_BUTTON_STYLES.map((value) => ({
            value,
            label: t(PLAY_BUTTON_LABELS[value]),
            preview: <PlayButtonThumb style={value} />,
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
 * Windows 强调色读不到时，卡头与基础色那一行写同一条错误
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
