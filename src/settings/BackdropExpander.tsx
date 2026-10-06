import { Button, Slider, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Image20Regular, Layer20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useId } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  BACKDROP_STORAGE_KEY,
  backdropChoiceAtom,
  backdropKey,
  materialAtom,
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
  type BackgroundParameters,
  type BackgroundSource,
} from '../theme/background/windowBackground.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { useService } from '../kit/useService.ts';
import styles from './BackdropExpander.module.css';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useHostAbsent } from './useHostAbsent.ts';
import { useSettingsLayout } from './useSettingsLayout.ts';

/** 下拉框里的先后：跟随首选项在最前，其余从无到最透。 */
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

const PARAMETERS = ['shade', 'blur', 'content', 'inactive'] as const;

const PARAMETER_LABELS: Readonly<Record<keyof BackgroundParameters, MessageKey>> = {
  shade: 'settings.backgroundShade',
  blur: 'settings.backgroundBlur',
  content: 'settings.backgroundContent',
  inactive: 'settings.backgroundInactive',
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
              icon={<Image20Regular />}
              aria-label={t('settings.backgroundPickImage')}
              disabled={absent || image.status === 'loading'}
              onClick={() => requestBackgroundImage(store, true)}
            />
          </Tooltip>
          <Tooltip content={t('settings.backgroundReloadImage')} relationship="label">
            <Button
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

/** 自绘背景的几项数值。深浅两套各记一份，调的是此刻这一档，小标题写明是哪一档。 */
function ParameterRows() {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(backgroundPreferencesAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const { compact } = useSettingsLayout();
  const store = useStore();
  const headingId = useId();
  return (
    <>
      <div id={headingId} className={styles.heading}>
        {t(scheme === 'dark' ? 'settings.backgroundValuesDark' : 'settings.backgroundValuesLight')}
      </div>
      {PARAMETERS.map((key) => {
        const [min, max] = BACKGROUND_LIMITS[key];
        const value = prefs[scheme][key];
        const text = key === 'blur' ? `${value} px` : `${value}%`;
        return (
          <SettingsRow key={key} title={t(PARAMETER_LABELS[key])} field>
            {({ labelId }) => (
              <div className={compact ? `${styles.control} ${styles.fill}` : styles.control}>
                <Slider
                  min={min}
                  max={max}
                  step={1}
                  value={value}
                  aria-labelledby={labelId}
                  aria-describedby={headingId}
                  aria-valuetext={text}
                  onChange={(_, data) => chooseBackgroundParameter(store, scheme, key, data.value)}
                />
                <output className={styles.value}>{text}</output>
              </div>
            )}
          </SettingsRow>
        );
      })}
    </>
  );
}

/**
 * 窗口背景：卡头选来源，材质各档由宿主画，封面、色场与图片由主题自己画。选材质时没有可调的项，只是一张
 * 普通卡；自绘来源下展开区是图片文件（只有图片来源有）与几项数值。无宿主时只禁用材质各档。
 */
export function BackdropExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const material = useAtomValueRawSync(materialAtom);
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
        : choice === 'inherit' && material
          ? t('settings.current', { name: t(EFFECT_LABELS[material]) })
          : undefined;
  return (
    <SettingsExpander
      icon={<Layer20Regular />}
      title={t('settings.backdrop')}
      description={description}
      error={imageError !== undefined}
      feedback={<LocalSaveNotice keys={[BACKDROP_STORAGE_KEY, WINDOW_BACKGROUND_KEY]} />}
      field
      defaultOpen={false}
      control={(ids) => (
        <SettingsSelect<SourceChoice>
          {...ids}
          options={[
            ...BACKDROP_CHOICES.map((value) => ({
              value,
              label: t(CHOICE_LABELS[value]),
              disabled: absent,
            })),
            { value: 'cover', label: t('settings.backgroundCover') },
            { value: 'palette', label: t('settings.backgroundPalette') },
            { value: 'image', label: t('settings.backgroundImage') },
          ]}
          value={source === 'material' ? choice : source}
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
      {source === 'material' ? null : (
        <>
          {source === 'image' && <ImageRow />}
          <ParameterRows />
        </>
      )}
    </SettingsExpander>
  );
}
