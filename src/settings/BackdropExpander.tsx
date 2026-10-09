import { Button, Slider, Tooltip, makeStyles } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Image20Regular, Layer20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { Fragment, useId } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  BACKDROP_STORAGE_KEY,
  backdropChoiceAtom,
  backdropKey,
  materialAtom,
  backdropFallbackAtom,
  nativeMaterialsAllowedAtom,
  backdropSolidAtom,
  type BackdropChoice,
  type BackdropEffect,
} from '../theme/backdrop.ts';
import {
  backgroundImageAtom,
  requestBackgroundImage,
  type BackgroundImageFailure,
} from '../theme/background/backgroundImage.ts';
import {
  BACKGROUND_LIMITS,
  WINDOW_BACKGROUND_KEY,
  backgroundPreferencesAtom,
  chooseBackgroundParameter,
  chooseBackgroundSource,
  resetBackgroundParameters,
  type BackgroundParameters,
  type BackgroundSource,
} from '../theme/background/windowBackground.ts';
import {
  APPEARANCE_LIMITS,
  BACKGROUND_APPEARANCE_KEY,
  backgroundAppearanceAtom,
  chooseBackgroundAppearance,
  type BackgroundAppearance,
} from '../theme/background/backgroundAppearance.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import {
  THEME_BACKGROUND_KEY,
  THEME_BACKGROUND_TINT_LIMIT,
  themeBackgroundTintAtom,
  chooseThemeBackgroundTint,
  resetThemeBackgroundTint,
} from '../theme/background/themeBackground.ts';
import { useService } from '../kit/useService.ts';
import styles from './BackdropExpander.module.css';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useHostAbsent } from './useHostAbsent.ts';
import { useSettingsLayout } from './useSettingsLayout.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

/** 跟随首选项在前，之后是主题自绘底与原生材质。 */
const BACKDROP_CHOICES: readonly BackdropChoice[] = [
  'inherit',
  'none',
  'mica',
  'mica-alt',
  'acrylic',
];

const CHOICE_LABELS: Readonly<Record<BackdropChoice, MessageKey>> = {
  inherit: 'settings.backdropInherit',
  none: 'settings.backdropNone',
  mica: 'settings.backdropMica',
  'mica-alt': 'settings.backdropMicaAlt',
  acrylic: 'settings.backdropAcrylic',
};

const EFFECT_LABELS: Readonly<Record<BackdropEffect, MessageKey>> = {
  none: 'settings.backdropNone',
  system: 'settings.backdropSystem',
  mica: 'settings.backdropMica',
  'mica-alt': 'settings.backdropMicaAlt',
  acrylic: 'settings.backdropAcrylic',
};

type BackgroundSetting =
  keyof BackgroundParameters | Exclude<keyof BackgroundAppearance, 'capsule'>;

interface ParameterGroup {
  readonly label: MessageKey;
  readonly keys: readonly BackgroundSetting[];
}

const PARAMETER_GROUPS: readonly ParameterGroup[] = [
  {
    label: 'settings.backgroundColorGroup',
    keys: ['shade', 'blur', 'saturation', 'brightness', 'inactive'],
  },
  {
    label: 'settings.backgroundSurfaceGroup',
    keys: ['content', 'tint', 'surfaceBlur', 'grain'],
  },
];

function isBackgroundParameter(key: BackgroundSetting): key is keyof BackgroundParameters {
  return key in BACKGROUND_LIMITS;
}

const useStyles = makeStyles({
  rail: { '::before': { display: 'none' } },
});

const PARAMETER_LABELS: Readonly<Record<BackgroundSetting, MessageKey>> = {
  shade: 'settings.backgroundShade',
  blur: 'settings.backgroundBlur',
  content: 'settings.backgroundContent',
  inactive: 'settings.backgroundInactive',
  saturation: 'settings.backgroundSaturation',
  brightness: 'settings.backgroundBrightness',
  tint: 'settings.backgroundTint',
  surfaceBlur: 'settings.backgroundSurfaceBlur',
  grain: 'settings.backgroundGrain',
};

const IMAGE_ERRORS: Readonly<Record<BackgroundImageFailure, MessageKey>> = {
  choose: 'settings.backgroundImageChooseFailed',
  read: 'settings.backgroundImageFailed',
  decode: 'settings.backgroundImageDecodeFailed',
  save: 'settings.backgroundImageSaveFailed',
  bytes: 'settings.backgroundImageTooLarge',
  pixels: 'settings.backgroundImageTooManyPixels',
};

type SourceChoice = BackdropChoice | Exclude<BackgroundSource, 'material'>;

/** 背景图片读不出来时的错误文案；不是图片来源、没有宿主或没出错时是 undefined。 */
function useImageError(): string | undefined {
  const t = useAtomValueRawSync(translateAtom);
  const { source } = useAtomValueRawSync(backgroundPreferencesAtom);
  const image = useAtomValueRawSync(backgroundImageAtom);
  const absent = useHostAbsent();
  return source === 'image' && !absent && image.status === 'failed'
    ? t(IMAGE_ERRORS[image.failure ?? 'read'])
    : undefined;
}

/** 选背景图片、按原路径重新读；说明行写文件名与大小限制，读不出来时写原因。 */
function ImageRow() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(backgroundPreferencesAtom);
  const image = useAtomValueRawSync(backgroundImageAtom);
  const failure = useImageError();
  const store = useStore();
  const absent = useHostAbsent();
  return (
    <SettingsRow
      title={t('settings.backgroundImageFile')}
      description={
        absent
          ? t('settings.needsHost')
          : (failure ??
            `${prefs.imageName || t('settings.backgroundImageEmpty')} · ${t('settings.backgroundImageLimits')}`)
      }
      error={failure !== undefined}
    >
      {() => (
        <div className={styles.actions}>
          <Tooltip content={t('settings.backgroundPickImage')} relationship="label">
            <Button
              appearance="subtle"
              className={viewControls.icon}
              icon={<Image20Regular />}
              aria-label={t('settings.backgroundPickImage')}
              disabled={absent || image.status === 'loading'}
              onClick={() => requestBackgroundImage(store, true)}
            />
          </Tooltip>
          <Tooltip content={t('settings.backgroundReloadImage')} relationship="label">
            <Button
              appearance="subtle"
              className={viewControls.icon}
              icon={<ArrowClockwise20Regular />}
              aria-label={t('settings.backgroundReloadImage')}
              disabled={absent || image.status === 'loading' || !prefs.imageName}
              onClick={() => requestBackgroundImage(store, false)}
            />
          </Tooltip>
        </div>
      )}
    </SettingsRow>
  );
}

function ThemeTintRow() {
  const t = useAtomValueRawSync(translateAtom);
  const tint = useAtomValueRawSync(themeBackgroundTintAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const store = useStore();
  const { compact } = useSettingsLayout();
  const classes = useStyles();
  return (
    <SettingsRow title={t('settings.themeBackgroundTint')} field>
      {({ labelId }) => (
        <div className={compact ? `${styles.control} ${styles.fill}` : styles.control}>
          <Slider
            rail={{ className: classes.rail }}
            min={0}
            max={THEME_BACKGROUND_TINT_LIMIT}
            step={1}
            value={tint}
            aria-labelledby={labelId}
            aria-valuetext={`${tint}%`}
            onChange={(_, data) => chooseThemeBackgroundTint(store, scheme, data.value)}
          />
          <output className={styles.value}>{tint}%</output>
        </div>
      )}
    </SettingsRow>
  );
}

/** 自绘背景的几项数值。深浅两套各记一份，调的是此刻这一档，小标题写明是哪一档。 */
function ParameterRows() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(backgroundPreferencesAtom);
  const solid = useAtomValueRawSync(backdropSolidAtom);
  const themed = prefs.source === 'material' && solid;
  const appearance = useAtomValueRawSync(backgroundAppearanceAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const { compact } = useSettingsLayout();
  const store = useStore();
  const headingId = useId();
  const classes = useStyles();
  return (
    <>
      <div className={styles.heading}>
        <span id={headingId}>
          {t(
            scheme === 'dark' ? 'settings.backgroundValuesDark' : 'settings.backgroundValuesLight',
          )}
        </span>
        <Button
          className={viewControls.icon}
          appearance="subtle"
          icon={<ArrowClockwise20Regular />}
          onClick={() => {
            resetBackgroundParameters(store, scheme);
            if (themed) resetThemeBackgroundTint(store, scheme);
          }}
        >
          {t('settings.backgroundReset')}
        </Button>
      </div>
      {themed && <ThemeTintRow />}
      {PARAMETER_GROUPS.filter(
        (group) =>
          (!themed && prefs.source !== 'palette') ||
          group.label !== 'settings.backgroundColorGroup',
      ).map((group) => (
        <Fragment key={group.label}>
          <div className={styles.group}>{t(group.label)}</div>
          {group.keys
            .filter((key) => key !== 'tint' || (!themed && prefs.source !== 'image'))
            .map((key) => {
              const [min, max] = isBackgroundParameter(key)
                ? BACKGROUND_LIMITS[key]
                : APPEARANCE_LIMITS[key];
              const value = isBackgroundParameter(key) ? prefs[scheme][key] : appearance[key];
              const text = key === 'blur' || key === 'surfaceBlur' ? `${value} px` : `${value}%`;
              return (
                <SettingsRow key={key} title={t(PARAMETER_LABELS[key])} field>
                  {({ labelId }) => (
                    <div className={compact ? `${styles.control} ${styles.fill}` : styles.control}>
                      <Slider
                        rail={{ className: classes.rail }}
                        min={min}
                        max={max}
                        step={1}
                        value={value}
                        aria-labelledby={labelId}
                        aria-describedby={headingId}
                        aria-valuetext={text}
                        onChange={(_, data) =>
                          isBackgroundParameter(key)
                            ? chooseBackgroundParameter(store, scheme, key, data.value)
                            : chooseBackgroundAppearance(store, scheme, key, data.value)
                        }
                      />
                      <output className={styles.value}>{text}</output>
                    </div>
                  )}
                </SettingsRow>
              );
            })}
        </Fragment>
      ))}
    </>
  );
}

/**
 * 原生材质由宿主绘制；主题背景与材质回退共用取色和阅读面参数。封面、色场和图片使用各自的背景参数。
 */
export function BackdropExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const material = useAtomValueRawSync(materialAtom);
  const fallback = useAtomValueRawSync(backdropFallbackAtom);
  const allowed = useAtomValueRawSync(nativeMaterialsAllowedAtom);
  const solid = useAtomValueRawSync(backdropSolidAtom);
  const { source } = useAtomValueRawSync(backgroundPreferencesAtom);
  const backdrop = useService(backdropKey);
  const store = useStore();
  const absent = useHostAbsent();
  const imageError = useImageError();
  const description =
    source !== 'material'
      ? imageError
      : absent
        ? t('settings.needsHost')
        : fallback
          ? t(
              fallback === 'windows10'
                ? 'settings.backdropWindows10'
                : fallback === 'unknown'
                  ? 'settings.backdropUnknown'
                  : 'settings.backdropFailed',
            )
          : choice === 'inherit' && material
            ? t('settings.current', { name: t(EFFECT_LABELS[material]) })
            : undefined;
  return (
    <SettingsExpander
      icon={<Layer20Regular />}
      title={t('settings.backdrop')}
      description={description}
      error={imageError !== undefined}
      feedback={
        <LocalSaveNotice
          keys={[
            BACKDROP_STORAGE_KEY,
            WINDOW_BACKGROUND_KEY,
            BACKGROUND_APPEARANCE_KEY,
            THEME_BACKGROUND_KEY,
          ]}
        />
      }
      field
      defaultOpen={false}
      control={(ids) => (
        <SettingsSelect<SourceChoice>
          {...ids}
          options={[
            ...BACKDROP_CHOICES.map((value) => ({
              value,
              label: t(CHOICE_LABELS[value]),
              disabled: value !== 'none' && (absent || !allowed),
            })),
            { value: 'cover', label: t('settings.backgroundCover') },
            { value: 'palette', label: t('settings.backgroundPalette') },
            { value: 'image', label: t('settings.backgroundImage') },
          ]}
          value={source === 'material' ? (fallback ? 'none' : choice) : source}
          onChange={(value) => {
            if (value === 'cover' || value === 'palette' || value === 'image')
              chooseBackgroundSource(store, value);
            else {
              backdrop.choose(value);
              chooseBackgroundSource(store, 'material');
            }
          }}
        />
      )}
    >
      {source === 'material' && !solid ? null : (
        <>
          {source === 'image' && <ImageRow />}
          <ParameterRows />
        </>
      )}
    </SettingsExpander>
  );
}
