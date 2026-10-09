import { useViewControlStyles } from '../theme/controlStyles.ts';
import { LyricsPreferenceCard } from './LyricsPreferenceCard.tsx';
import { Input, SpinButton, Switch, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  TextDescription20Regular,
  Settings20Regular,
  TextFont20Regular,
  TextAlignCenter20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_OPTIMIZATIONS,
  LYRICS_MASK_MODES,
  lyricsDisplayKey,
} from '../lyrics/lyricsDisplay.ts';
import {
  LYRICS_ALIGN_ANCHORS,
  LYRICS_MOTION_PRESETS,
  lyricsMotionKey,
} from '../lyrics/lyricsMotion.ts';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsCard, type SettingsCardIds } from './SettingsCard.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';
import styles from './LyricsSection.module.css';

const useStyles = makeStyles({
  number: { width: '112px', minWidth: 0 },
  input: { width: '220px', maxWidth: '100%' },
  fill: { width: '100%' },
});

interface NumberSettingProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly disabled?: boolean;
  onChange(value: number): void;
}

function NumberControl({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
  labelId,
  descriptionId,
}: Omit<NumberSettingProps, 'label'> & SettingsCardIds) {
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
      step={step}
      disabled={disabled}
      onChange={(_, data) => {
        const next = data.value ?? Number(data.displayValue);
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
      }}
    />
  );
}

function NumberSetting({ label, ...control }: NumberSettingProps) {
  return (
    <SettingsRow title={label} field disabled={control.disabled}>
      {(ids) => <NumberControl {...control} {...ids} />}
    </SettingsRow>
  );
}

export function LyricsSection({
  disabled,
  saveNotice,
}: {
  readonly disabled: boolean;
  readonly saveNotice: ReactNode;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(lyricsMotionKey);
  const displayService = useService(lyricsDisplayKey);
  const pref = useAtomValueRawSync(service.pref);
  const motion = useAtomValueRawSync(service.motion);
  const display = useAtomValueRawSync(displayService.display);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  return (
    <div className={styles.root} data-lyrics-settings>
      <fieldset className={styles.fields} disabled={disabled}>
        <LyricsPreferenceCard />
        <SettingsCard icon={<TextFont20Regular />} title={t('lyrics.fontSize')} field>
          {(ids) => (
            <NumberControl
              {...ids}
              value={display.fontSize}
              min={12}
              max={48}
              onChange={(fontSize) => void displayService.update({ fontSize })}
            />
          )}
        </SettingsCard>
        <SettingsExpander
          icon={<TextFont20Regular />}
          title={t('lyrics.typography')}
          defaultOpen={false}
        >
          <SettingsRow title={t('lyrics.fontFamily')} field>
            {({ labelId, descriptionId }) => (
              <Input
                className={mergeClasses(classes.input, compact && classes.fill, controls.field)}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                placeholder={t('lyrics.followInterface')}
                value={display.fontFamily}
                onChange={(_, data) => void displayService.update({ fontFamily: data.value })}
              />
            )}
          </SettingsRow>
          <SettingsRow title={t('lyrics.translationSizeMode')} field>
            {(ids) => (
              <SettingsSelect
                {...ids}
                value={display.translationFontSize === null ? 'auto' : 'custom'}
                options={[
                  { value: 'auto', label: t('lyrics.translationSizeAuto') },
                  { value: 'custom', label: t('lyrics.preset.custom') },
                ]}
                onChange={(value) =>
                  void displayService.update({
                    translationFontSize: value === 'auto' ? null : Math.round(display.fontSize / 2),
                  })
                }
              />
            )}
          </SettingsRow>
          {display.translationFontSize !== null && (
            <NumberSetting
              label={t('lyrics.translationFontSize')}
              value={display.translationFontSize}
              min={10}
              max={48}
              onChange={(translationFontSize) =>
                void displayService.update({ translationFontSize })
              }
            />
          )}
          {(['showTranslation', 'showRomanization'] as const).map((name) => (
            <SettingsRow key={name} title={t(`lyrics.${name}`)}>
              {({ labelId, descriptionId }) => (
                <Switch
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  checked={display[name]}
                  onChange={(_, data) => void displayService.update({ [name]: data.checked })}
                />
              )}
            </SettingsRow>
          ))}
        </SettingsExpander>
        <SettingsExpander
          icon={<Settings20Regular />}
          title={t('lyrics.preset')}
          field
          defaultOpen={false}
          control={(ids) => (
            <SettingsSelect
              {...ids}
              value={pref.preset}
              options={LYRICS_MOTION_PRESETS.map((value) => ({
                value,
                label: t(`lyrics.preset.${value}`),
              }))}
              onChange={service.choosePreset}
            />
          )}
        >
          {(['spring', 'blur', 'scale', 'hidePassedLines'] as const).map((name) => (
            <SettingsRow key={name} title={t(`lyrics.${name}`)}>
              {({ labelId, descriptionId }) => (
                <Switch
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  checked={motion[name]}
                  onChange={(_, data) => service.customize({ [name]: data.checked })}
                />
              )}
            </SettingsRow>
          ))}
          <NumberSetting
            label={t('lyrics.wordFadeWidth')}
            value={motion.wordFadeWidth}
            min={0.0001}
            max={2}
            step={0.05}
            onChange={(wordFadeWidth) => service.customize({ wordFadeWidth })}
          />
        </SettingsExpander>
        <SettingsExpander
          icon={<TextAlignCenter20Regular />}
          title={t('lyrics.position')}
          field
          defaultOpen={false}
          control={(ids) => (
            <SettingsSelect
              {...ids}
              value={motion.alignAnchor}
              options={LYRICS_ALIGN_ANCHORS.map((value) => ({
                value,
                label: t(`lyrics.anchor.${value}`),
              }))}
              onChange={(alignAnchor) => service.customize({ alignAnchor })}
            />
          )}
        >
          <NumberSetting
            label={t('lyrics.alignPosition')}
            value={Math.round(motion.alignPosition * 100)}
            min={0}
            max={100}
            onChange={(value) => service.customize({ alignPosition: value / 100 })}
          />
        </SettingsExpander>
        <SettingsExpander
          icon={<Settings20Regular />}
          title={t('lyrics.springSettings')}
          defaultOpen={false}
        >
          <div className={styles.rows}>
            {(['mass', 'damping', 'stiffness'] as const).map((name) => (
              <NumberSetting
                key={name}
                label={t(`lyrics.${name}`)}
                value={motion.scaleSpring[name]}
                min={name === 'mass' ? 0.1 : 1}
                max={name === 'mass' ? 10 : name === 'damping' ? 100 : 1000}
                step={name === 'mass' ? 0.1 : 1}
                disabled={!motion.spring || !motion.scale}
                onChange={(value) =>
                  service.customize({
                    scaleSpring: { ...motion.scaleSpring, [name]: value },
                  })
                }
              />
            ))}
          </div>
        </SettingsExpander>
        <SettingsExpander
          icon={<Settings20Regular />}
          title={t('lyrics.transitionSettings')}
          defaultOpen={false}
        >
          <div className={styles.rows}>
            <NumberSetting
              label={t('lyrics.transitionMs')}
              value={motion.transitionMs}
              min={0}
              max={2000}
              step={10}
              disabled={motion.spring}
              onChange={(transitionMs) => service.customize({ transitionMs })}
            />
            {(['x1', 'y1', 'x2', 'y2'] as const).map((name, index) => (
              <NumberSetting
                key={name}
                label={name}
                value={motion.transitionCurve[index] ?? 0}
                min={index % 2 ? -1 : 0}
                max={index % 2 ? 2 : 1}
                step={0.05}
                disabled={motion.spring}
                onChange={(value) => {
                  const [x1, y1, x2, y2] = motion.transitionCurve;
                  service.customize({
                    transitionCurve: [
                      index === 0 ? value : x1,
                      index === 1 ? value : y1,
                      index === 2 ? value : x2,
                      index === 3 ? value : y2,
                    ],
                  });
                }}
              />
            ))}
          </div>
        </SettingsExpander>
        <SettingsExpander
          icon={<TextDescription20Regular />}
          title={t('lyrics.processing')}
          defaultOpen={false}
        >
          <div className={styles.rows}>
            {LYRICS_OPTIMIZATIONS.map((name) => (
              <SettingsRow key={name} title={t(`lyrics.optimize.${name}`)}>
                {({ labelId, descriptionId }) => (
                  <Switch
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                    checked={display.optimize[name]}
                    onChange={(_, data) =>
                      void displayService.update({
                        optimize: { ...display.optimize, [name]: data.checked },
                      })
                    }
                  />
                )}
              </SettingsRow>
            ))}
            <SettingsRow title={t('lyrics.maskMode')} field>
              {(ids) => (
                <SettingsSelect
                  {...ids}
                  value={display.maskMode}
                  onChange={(maskMode) => void displayService.update({ maskMode })}
                  options={LYRICS_MASK_MODES.map((value) => ({
                    value,
                    label: t(`lyrics.mask.${value || 'none'}`),
                  }))}
                />
              )}
            </SettingsRow>
            <SettingsRow title={t('lyrics.maskChar')} field disabled={!display.maskMode}>
              {({ labelId, descriptionId }) => (
                <Input
                  className={mergeClasses(classes.input, compact && classes.fill, controls.field)}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  value={display.maskChar}
                  disabled={!display.maskMode}
                  onChange={(_, data) =>
                    void displayService.update({ maskChar: [...data.value].at(-1) ?? '*' })
                  }
                />
              )}
            </SettingsRow>
          </div>
        </SettingsExpander>
        <SettingsExpander
          icon={<Settings20Regular />}
          title={t('lyrics.rendering')}
          defaultOpen={false}
        >
          <div className={styles.rows}>
            {(['autoSeek', 'backgroundLast'] as const).map((name) => (
              <SettingsRow key={name} title={t(`lyrics.${name}`)}>
                {({ labelId, descriptionId }) => (
                  <Switch
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                    checked={display[name]}
                    onChange={(_, data) => void displayService.update({ [name]: data.checked })}
                  />
                )}
              </SettingsRow>
            ))}
            <NumberSetting
              label={t('lyrics.overscan')}
              value={display.overscan}
              min={0}
              max={2000}
              step={50}
              onChange={(overscan) => void displayService.update({ overscan })}
            />
          </div>
        </SettingsExpander>
      </fieldset>
      {saveNotice}
    </div>
  );
}
