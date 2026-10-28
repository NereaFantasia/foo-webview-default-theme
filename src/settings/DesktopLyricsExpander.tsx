import { Button, Slider, Switch, makeStyles } from '@fluentui/react-components';
import { Subtitles20Regular } from '@fluentui/react-icons';
import { hexFromArgb, TonalPalette } from '@material/material-color-utilities';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { desktopLyricsKey, DESKTOP_LYRICS_SUNG_STEP } from '../lyrics/desktop/desktopLyrics.ts';
import {
  DESKTOP_LYRICS_ALIGNS,
  DESKTOP_LYRICS_BACKGROUNDS,
  DESKTOP_LYRICS_PALETTES,
  DESKTOP_LYRICS_MOTION_PRESETS,
  DESKTOP_LYRICS_PREF,
  DESKTOP_LYRICS_SIZES,
  type DesktopLyricsPref,
} from '../lyrics/desktop/desktopLyricsPrefs.ts';
import { accentRampAtom } from '../theme/accentState.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { darkTheme } from '../theme/themes.ts';
import { AlignIcon } from './AlignIcon.tsx';
import { ColorPicker } from './ColorPicker.tsx';
import styles from './DesktopLyricsExpander.module.css';
import { SettingsChoice } from './SettingsChoice.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSegmented } from './SettingsSegmented.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { DesktopLyricsThumb } from './thumbnails/DesktopLyricsThumb.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';

const HUES = [20, 50, 90, 150, 200, 250, 290, 340];
const tone = (value: number, chroma: number) =>
  HUES.map((hue) => hexFromArgb(TonalPalette.fromHueAndChroma(hue, chroma).tone(value)));
/** 歌词在深色底板或桌面上显示：字色取白与各色相的浅色，光晕取近黑与各色相的深色 */
const UNSUNG_DEFAULT = darkTheme.colorNeutralForeground1;
const GLOW_DEFAULT = darkTheme.colorNeutralBackground4;
const TEXT_COLORS = [UNSUNG_DEFAULT, ...tone(80, 48)];
const GLOW_COLORS = [GLOW_DEFAULT, ...tone(15, 36)];

const useStyles = makeStyles({ rail: { '::before': { display: 'none' } } });

/**
 * 设置 ›「歌词」组末尾的桌面歌词卡：卡头开关；展开区是显示参数。背景选底板时换出浓度与染色，
 * 选透明时换出光晕颜色；配色选自定义时换出已唱、未唱两色
 */
export function DesktopLyricsExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(desktopLyricsKey);
  const pref = useAtomValueRawSync(service.pref);
  const { status, failed } = useAtomValueRawSync(service.state);
  const ramp = useAtomValueRawSync(accentRampAtom);
  const viewControls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  const classes = useStyles();
  const update = (patch: Partial<DesktopLyricsPref>) => service.update(patch);
  const toggle = (name: 'showTranslation' | 'showRomanization' | 'autoHide' | 'plateTint') => (
    <SettingsRow key={name} title={t(`desktopLyrics.${name}`)} nested={name === 'plateTint'}>
      {({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={pref[name]}
          onChange={(_, data) => update({ [name]: data.checked })}
        />
      )}
    </SettingsRow>
  );
  const color = (
    name: 'sungColor' | 'unsungColor' | 'glowColor',
    fallback: string,
    colors: readonly string[],
  ) => (
    <SettingsRow title={t(`desktopLyrics.${name}`)} nested>
      {() => (
        <ColorPicker
          value={pref[name] || fallback}
          label={t(`desktopLyrics.${name}`)}
          colors={colors}
          onChange={(value) => update({ [name]: value })}
        />
      )}
    </SettingsRow>
  );
  const percent = Math.round(pref.plateOpacity * 100);
  return (
    <SettingsExpander
      icon={<Subtitles20Regular />}
      title={t('desktopLyrics.title')}
      description={failed ? t('desktopLyrics.openFailed') : undefined}
      error={failed}
      feedback={
        <SettingsSaveNotice persistence={service.persistence} keys={[DESKTOP_LYRICS_PREF.key]} />
      }
      control={({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={status !== 'closed'}
          onChange={(_, data) => service.setOpen(data.checked)}
        />
      )}
    >
      <SettingsRow title={t('lyrics.preset')} field>
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={pref.motionPreset}
            options={DESKTOP_LYRICS_MOTION_PRESETS.map((value) => ({
              value,
              label: t(`lyrics.preset.${value}`),
            }))}
            onChange={(motionPreset) => update({ motionPreset })}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('desktopLyrics.size')} field>
        {() => (
          <SettingsSegmented
            label={t('desktopLyrics.size')}
            value={pref.size}
            options={DESKTOP_LYRICS_SIZES.map((value) => ({
              value,
              label: t(`desktopLyrics.size.${value}`),
              icon: (
                <span className={`${styles.aa} ${styles[value]}`} aria-hidden>
                  Aa
                </span>
              ),
            }))}
            onChange={(size) => update({ size })}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('desktopLyrics.align')} field>
        {() => (
          <SettingsSegmented
            label={t('desktopLyrics.align')}
            value={pref.align}
            options={DESKTOP_LYRICS_ALIGNS.map((value) => ({
              value,
              label: t(`desktopLyrics.align.${value}`),
              icon: <AlignIcon align={value} />,
            }))}
            onChange={service.setAlign}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('desktopLyrics.palette')} block>
        {(ids) => (
          <SettingsChoice
            {...ids}
            value={pref.palette}
            options={DESKTOP_LYRICS_PALETTES.map((value) => ({
              value,
              label: t(`desktopLyrics.palette.${value}`),
              preview: <DesktopLyricsThumb background="plate" palette={value} />,
            }))}
            onChange={(palette) => update({ palette })}
          />
        )}
      </SettingsRow>
      {pref.palette === 'custom' && (
        <>
          {color('sungColor', ramp[DESKTOP_LYRICS_SUNG_STEP], TEXT_COLORS)}
          {color('unsungColor', UNSUNG_DEFAULT, TEXT_COLORS)}
        </>
      )}
      <SettingsRow title={t('desktopLyrics.background')} block>
        {(ids) => (
          <SettingsChoice
            {...ids}
            value={pref.background}
            options={DESKTOP_LYRICS_BACKGROUNDS.map((value) => ({
              value,
              label: t(`desktopLyrics.background.${value}`),
              preview: <DesktopLyricsThumb background={value} palette="white" />,
            }))}
            onChange={(background) => update({ background })}
          />
        )}
      </SettingsRow>
      {pref.background === 'plate' ? (
        <>
          <SettingsRow title={t('desktopLyrics.plateOpacity')} field nested>
            {({ labelId }) => (
              <div className={compact ? `${styles.slider} ${styles.fill}` : styles.slider}>
                <Slider
                  rail={{ className: classes.rail }}
                  min={10}
                  max={100}
                  step={5}
                  value={percent}
                  aria-labelledby={labelId}
                  aria-valuetext={`${percent}%`}
                  onChange={(_, data) => update({ plateOpacity: data.value / 100 })}
                />
                <output className={styles.value}>{percent}%</output>
              </div>
            )}
          </SettingsRow>
          {toggle('plateTint')}
        </>
      ) : (
        color('glowColor', GLOW_DEFAULT, GLOW_COLORS)
      )}
      {toggle('showTranslation')}
      {toggle('showRomanization')}
      {toggle('autoHide')}
      <SettingsRow title={t('desktopLyrics.position')}>
        {({ labelId }) => (
          <Button
            className={viewControls.field}
            aria-describedby={labelId}
            onClick={service.resetPosition}
          >
            {t('desktopLyrics.recenter')}
          </Button>
        )}
      </SettingsRow>
    </SettingsExpander>
  );
}
