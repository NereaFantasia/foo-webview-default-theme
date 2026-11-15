import { Slider, SpinButton, Switch, makeStyles, mergeClasses } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { translationFontSizeOf } from '../lyrics/desktop/desktopLyricsHeight.ts';
import { motionCustomFrom } from '../lyrics/desktop/desktopLyricsMotion.ts';
import {
  DESKTOP_LYRICS_MOTION_PRESETS,
  DESKTOP_LYRICS_SIZES,
  DESKTOP_LYRICS_SIZE_RANGE,
  DESKTOP_LYRICS_TRANSLATION_RANGE,
  desktopFontSizeOf,
  type DesktopLyricsPref,
} from '../lyrics/desktop/desktopLyricsPrefs.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './DesktopLyricsExpander.module.css';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSegmented } from './SettingsSegmented.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';

// 连续的轨道：当前行位置是连续量，不画步进刻度
const useStyles = makeStyles({
  rail: { '::before': { display: 'none' } },
  number: { width: '112px', minWidth: 0 },
  fill: { width: '100%' },
});

interface RowsProps {
  readonly pref: DesktopLyricsPref;
  update(patch: Partial<DesktopLyricsPref>): void;
}

function NumberBox({
  value,
  min,
  max,
  labelId,
  descriptionId,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly labelId: string;
  readonly descriptionId: string | undefined;
  onChange(value: number): void;
}) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  return (
    <SpinButton
      className={mergeClasses(classes.number, compact && classes.fill, controls.field)}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      value={value}
      min={min}
      max={max}
      onChange={(_, data) => {
        const next = data.value ?? Number(data.displayValue);
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
      }}
    />
  );
}

/**
 * 动效预设一行，选「自定义」时换出「多行歌词」小标题与四项：这四项只管多行窗口，单行的动效不受影响
 * 第一次切到自定义时以当时的预设为起点，之后各项记在偏好里
 */
export function DesktopMotionRows({ pref, update }: RowsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const custom = pref.motionCustom;
  const percent = Math.round((custom?.alignPosition ?? 0.5) * 100);
  const change = (patch: Partial<NonNullable<typeof custom>>) => {
    if (custom) update({ motionCustom: { ...custom, ...patch } });
  };
  return (
    <>
      <SettingsRow title={t('lyrics.preset')} field>
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={pref.motionPreset}
            options={DESKTOP_LYRICS_MOTION_PRESETS.map((value) => ({
              value,
              label: t(`lyrics.preset.${value}`),
            }))}
            onChange={(motionPreset) =>
              update(
                motionPreset === 'custom'
                  ? {
                      motionPreset,
                      motionCustom:
                        pref.motionCustom ??
                        motionCustomFrom(pref.motionPreset === 'winui' ? 'winui' : 'amll'),
                    }
                  : { motionPreset },
              )
            }
          />
        )}
      </SettingsRow>
      {pref.motionPreset === 'custom' && custom && (
        <>
          <div className={styles.caption}>{t('desktopLyrics.multiline')}</div>
          {(['blur', 'scale', 'hidePassedLines'] as const).map((name) => (
            <SettingsRow key={name} title={t(`lyrics.${name}`)} nested>
              {({ labelId, descriptionId }) => (
                <Switch
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  checked={custom[name]}
                  onChange={(_, data) => change({ [name]: data.checked })}
                />
              )}
            </SettingsRow>
          ))}
          <SettingsRow title={t('lyrics.position')} field nested>
            {({ labelId }) => (
              <div className={styles.slider}>
                <Slider
                  rail={{ className: classes.rail }}
                  min={0}
                  max={100}
                  step={5}
                  value={percent}
                  aria-labelledby={labelId}
                  aria-valuetext={`${percent}%`}
                  onChange={(_, data) => change({ alignPosition: data.value / 100 })}
                />
                <output className={styles.value}>{percent}%</output>
              </div>
            )}
          </SettingsRow>
        </>
      )}
    </>
  );
}

/** 字号一行（前四档加自定义，自定义时换出像素值）与译文字号一行（随正文缩放或自定义像素值） */
export function DesktopSizeRows({ pref, update }: RowsProps) {
  const t = useAtomValueRawSync(translateAtom);
  const fontSize = desktopFontSizeOf(pref);
  return (
    <>
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
      {pref.size === 'custom' && (
        <SettingsRow title={t('desktopLyrics.sizePx')} nested>
          {(ids) => (
            <NumberBox
              {...ids}
              value={pref.customSize}
              min={DESKTOP_LYRICS_SIZE_RANGE.min}
              max={DESKTOP_LYRICS_SIZE_RANGE.max}
              onChange={(customSize) => update({ customSize })}
            />
          )}
        </SettingsRow>
      )}
      <SettingsRow title={t('lyrics.translationSizeMode')} field>
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={pref.translationSize === null ? 'auto' : 'custom'}
            options={[
              { value: 'auto', label: t('lyrics.translationSizeAuto') },
              { value: 'custom', label: t('lyrics.preset.custom') },
            ]}
            onChange={(value) =>
              update({
                translationSize: value === 'auto' ? null : translationFontSizeOf(fontSize),
              })
            }
          />
        )}
      </SettingsRow>
      {pref.translationSize !== null && (
        <SettingsRow title={t('lyrics.translationFontSize')} nested>
          {(ids) => (
            <NumberBox
              {...ids}
              value={pref.translationSize ?? DESKTOP_LYRICS_TRANSLATION_RANGE.min}
              min={DESKTOP_LYRICS_TRANSLATION_RANGE.min}
              max={DESKTOP_LYRICS_TRANSLATION_RANGE.max}
              onChange={(translationSize) => update({ translationSize })}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}
