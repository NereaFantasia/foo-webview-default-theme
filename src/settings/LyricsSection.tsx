import { useViewControlStyles } from '../theme/controlStyles.ts';
import { LyricsPreferenceCard } from './LyricsPreferenceCard.tsx';
import { Input, Switch, makeStyles, mergeClasses } from '@fluentui/react-components';
import { Settings20Regular, TextDescription20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_OPTIMIZATIONS,
  LYRICS_MASK_MODES,
  lyricsDisplayKey,
} from '../lyrics/lyricsDisplay.ts';
import { DesktopLyricsExpander } from './DesktopLyricsExpander.tsx';
import { LyricsRememberCard } from './LyricsCacheCards.tsx';
import { LyricsViewExpander } from './LyricsViewExpander.tsx';
import { NumberSetting } from './NumberSetting.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { SettingsSubheading } from './SettingsSubheading.tsx';
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
  const displayService = useService(lyricsDisplayKey);
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
        <LyricsViewExpander view="main" />
        <LyricsViewExpander view="immersive" />
        <DesktopLyricsExpander />
        <SettingsSubheading>{t('settings.subLyricsShared')}</SettingsSubheading>
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
            <SettingsRow title={t('lyrics.autoSeek')}>
              {({ labelId, descriptionId }) => (
                <Switch
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  checked={display.autoSeek}
                  onChange={(_, data) => void displayService.update({ autoSeek: data.checked })}
                />
              )}
            </SettingsRow>
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
