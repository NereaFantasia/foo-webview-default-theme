import { useViewControlStyles } from '../theme/controlStyles.ts';
import { LyricsPreferenceCard } from './LyricsPreferenceCard.tsx';
import { Input, Switch, makeStyles, mergeClasses } from '@fluentui/react-components';
import { FontPicker } from '../kit/FontPicker.tsx';
import {
  TextDescription20Regular,
  Settings20Regular,
  TextFont20Regular,
  TextAlignCenter20Regular,
  TextAlignJustify20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_ALIGNS,
  LYRICS_OPTIMIZATIONS,
  LYRICS_MASK_MODES,
  lyricsDisplayKey,
} from '../lyrics/lyricsDisplay.ts';
import { LYRICS_ALIGN_ANCHORS, lyricsMotionKey } from '../lyrics/lyricsMotion.ts';
import { AlignIcon } from './AlignIcon.tsx';
import { DesktopLyricsExpander } from './DesktopLyricsExpander.tsx';
import { FontWeightRow } from './FontWeightRow.tsx';
import { LyricsRememberCard } from './LyricsCacheCards.tsx';
import { LyricsMotionExpander } from './LyricsMotionExpander.tsx';
import { NumberControl, NumberSetting } from './NumberSetting.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsChoice } from './SettingsChoice.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSegmented } from './SettingsSegmented.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { SettingsSubheading } from './SettingsSubheading.tsx';
import { LyricsPositionThumb } from './thumbnails/LyricsPositionThumb.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';
import styles from './LyricsSection.module.css';

const useStyles = makeStyles({
  input: { width: '220px', maxWidth: '100%' },
  fill: { width: '100%' },
});

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
  const motion = useAtomValueRawSync(service.motion);
  const display = useAtomValueRawSync(displayService.display);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  return (
    <div className={styles.root} data-lyrics-settings>
      <fieldset className={styles.fields} disabled={disabled}>
        <SettingsSubheading>{t('settings.subLyricsSources')}</SettingsSubheading>
        <LyricsPreferenceCard />
        <LyricsRememberCard />
        <SettingsSubheading>{t('settings.subLyricsDisplay')}</SettingsSubheading>
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
        {/* 分段里已经有三个对齐图标，卡图标取固定的一个，免得同屏两套 */}
        <SettingsCard icon={<TextAlignJustify20Regular />} title={t('lyrics.textAlign')} field>
          {() => (
            <SettingsSegmented
              label={t('lyrics.textAlign')}
              value={display.align}
              options={LYRICS_ALIGNS.map((value) => ({
                value,
                label: t(`lyrics.textAlign.${value}`),
                icon: <AlignIcon align={value} />,
              }))}
              onChange={(align) => void displayService.update({ align })}
            />
          )}
        </SettingsCard>
        <SettingsExpander
          icon={<TextFont20Regular />}
          title={t('lyrics.typography')}
          defaultOpen={false}
        >
          <SettingsRow title={t('lyrics.fontFamily')} field>
            {(ids) => (
              <FontPicker
                {...ids}
                value={display.fontFamily}
                defaultLabel={t('lyrics.followInterface')}
                fill={compact}
                onChange={(fontFamily) => void displayService.update({ fontFamily })}
              />
            )}
          </SettingsRow>
          <FontWeightRow
            family={display.fontFamily}
            weight={display.fontWeight}
            onChange={(fontWeight) => void displayService.update({ fontWeight })}
          />
          <SettingsRow title={t('lyrics.fontImmersive')} field>
            {(ids) => (
              <FontPicker
                {...ids}
                value={display.immersiveFontFamily}
                defaultLabel={t('lyrics.followPanel')}
                fill={compact}
                onChange={(immersiveFontFamily) =>
                  void displayService.update({ immersiveFontFamily })
                }
              />
            )}
          </SettingsRow>
          <FontWeightRow
            family={display.immersiveFontFamily}
            weight={display.immersiveFontWeight}
            onChange={(immersiveFontWeight) => void displayService.update({ immersiveFontWeight })}
          />
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
        <LyricsMotionExpander />
        <SettingsCard
          icon={<TextAlignCenter20Regular />}
          title={t('lyrics.position')}
          block
          footer={
            <NumberSetting
              label={t('lyrics.alignPosition')}
              value={Math.round(motion.alignPosition * 100)}
              min={0}
              max={100}
              onChange={(value) => service.customize({ alignPosition: value / 100 })}
            />
          }
        >
          {(ids) => (
            <SettingsChoice
              {...ids}
              value={motion.alignAnchor}
              options={LYRICS_ALIGN_ANCHORS.map((value) => ({
                value,
                label: t(`lyrics.anchor.${value}`),
                preview: <LyricsPositionThumb anchor={value} />,
              }))}
              onChange={(alignAnchor) => service.customize({ alignAnchor })}
            />
          )}
        </SettingsCard>
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
            {display.maskMode && (
              <SettingsRow title={t('lyrics.maskChar')} field nested>
                {({ labelId, descriptionId }) => (
                  <Input
                    className={mergeClasses(classes.input, compact && classes.fill, controls.field)}
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                    value={display.maskChar}
                    onChange={(_, data) =>
                      void displayService.update({ maskChar: [...data.value].at(-1) ?? '*' })
                    }
                  />
                )}
              </SettingsRow>
            )}
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
        <DesktopLyricsExpander />
      </fieldset>
      {saveNotice}
    </div>
  );
}
