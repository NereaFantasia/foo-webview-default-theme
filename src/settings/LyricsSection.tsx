import {
  Field,
  Input,
  Select,
  SpinButton,
  Switch,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { TextDescription20Regular, Settings20Regular } from '@fluentui/react-icons';
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
import styles from './LyricsSection.module.css';

const useStyles = makeStyles({
  field: { minWidth: 0 },
  select: { width: '100%' },
  number: { width: '112px', minWidth: 0 },
  switch: { marginLeft: tokens.spacingHorizontalNone },
});

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly disabled?: boolean;
  onChange(value: number): void;
}) {
  const classes = useStyles();
  return (
    <Field label={label} orientation="horizontal" className={classes.field}>
      <SpinButton
        className={classes.number}
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
    </Field>
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
  return (
    <div className={styles.root} data-lyrics-settings>
      <fieldset className={styles.fields} disabled={disabled}>
        <Field label={t('lyrics.preset')}>
          <Select
            className={classes.select}
            value={pref.preset}
            onChange={(_, data) => {
              const next = LYRICS_MOTION_PRESETS.find((preset) => preset === data.value);
              if (next) service.choosePreset(next);
            }}
          >
            {LYRICS_MOTION_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {t(`lyrics.preset.${preset}`)}
              </option>
            ))}
          </Select>
        </Field>
        <NumberSetting
          label={t('lyrics.fontSize')}
          value={display.fontSize}
          min={12}
          max={48}
          onChange={(fontSize) => void displayService.update({ fontSize })}
        />
        {(['spring', 'blur', 'scale', 'hidePassedLines'] as const).map((name) => (
          <Switch
            key={name}
            className={classes.switch}
            label={t(`lyrics.${name}`)}
            checked={motion[name]}
            onChange={(_, data) => service.customize({ [name]: data.checked })}
          />
        ))}
        <NumberSetting
          label={t('lyrics.wordFadeWidth')}
          value={motion.wordFadeWidth}
          min={0.0001}
          max={2}
          step={0.05}
          onChange={(wordFadeWidth) => service.customize({ wordFadeWidth })}
        />
        <Field label={t('lyrics.alignAnchor')}>
          <Select
            className={classes.select}
            value={motion.alignAnchor}
            onChange={(_, data) => {
              const alignAnchor = LYRICS_ALIGN_ANCHORS.find((value) => value === data.value);
              if (alignAnchor) service.customize({ alignAnchor });
            }}
          >
            {LYRICS_ALIGN_ANCHORS.map((anchor) => (
              <option key={anchor} value={anchor}>
                {t(`lyrics.anchor.${anchor}`)}
              </option>
            ))}
          </Select>
        </Field>
        <NumberSetting
          label={t('lyrics.alignPosition')}
          value={Math.round(motion.alignPosition * 100)}
          min={0}
          max={100}
          onChange={(value) => service.customize({ alignPosition: value / 100 })}
        />
        <SettingsExpander
          icon={<Settings20Regular />}
          title={t('lyrics.springSettings')}
          defaultOpen={false}
        >
          <div className={styles.fields}>
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
          <div className={styles.fields}>
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
          <div className={styles.fields}>
            {LYRICS_OPTIMIZATIONS.map((name) => (
              <Switch
                key={name}
                label={t(`lyrics.optimize.${name}`)}
                checked={display.optimize[name]}
                onChange={(_, data) =>
                  void displayService.update({
                    optimize: { ...display.optimize, [name]: data.checked },
                  })
                }
              />
            ))}
            <Field label={t('lyrics.maskMode')}>
              <Select
                value={display.maskMode}
                onChange={(_, data) => {
                  const maskMode = LYRICS_MASK_MODES.find((value) => value === data.value);
                  if (maskMode !== undefined) void displayService.update({ maskMode });
                }}
              >
                {LYRICS_MASK_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`lyrics.mask.${mode || 'none'}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('lyrics.maskChar')}>
              <Input
                value={display.maskChar}
                disabled={!display.maskMode}
                onChange={(_, data) =>
                  void displayService.update({ maskChar: [...data.value].at(-1) ?? '*' })
                }
              />
            </Field>
          </div>
        </SettingsExpander>
        <SettingsExpander
          icon={<Settings20Regular />}
          title={t('lyrics.rendering')}
          defaultOpen={false}
        >
          <div className={styles.fields}>
            {(['autoSeek', 'backgroundLast'] as const).map((name) => (
              <Switch
                key={name}
                label={t(`lyrics.${name}`)}
                checked={display[name]}
                onChange={(_, data) => void displayService.update({ [name]: data.checked })}
              />
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
