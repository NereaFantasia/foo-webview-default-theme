import { useViewControlStyles } from '../theme/controlStyles.ts';
import { Button, Switch } from '@fluentui/react-components';
import {
  ArrowUp16Regular,
  ArrowDown16Regular,
  TextSortAscending20Regular,
  Globe20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import { LYRICS_PRIORITY, WORD_FIRST, lyricsPrefsKey } from '../lyrics/lyricsPrefs.ts';
import { LYRICS_SOURCE_IDS } from '../lyrics/online/lyricsSource.ts';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';

function reordered<T>(values: readonly T[], index: number, delta: number): T[] {
  const next = [...values];
  const target = index + delta;
  const value = next[index];
  const neighbor = next[target];
  if (value !== undefined && neighbor !== undefined) {
    next[index] = neighbor;
    next[target] = value;
  }
  return next;
}

export function LyricsPreferenceCard() {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const locale = useAtomValueRawSync(localeAtom).active;
  const service = useService(lyricsPrefsKey);
  const pref = useAtomValueRawSync(service.pref);
  const order = pref.order ?? LYRICS_PRIORITY;
  const preset =
    order.join() === LYRICS_PRIORITY.join()
      ? 'local'
      : order.join() === WORD_FIRST.join()
        ? 'word'
        : 'custom';
  const sources =
    pref.sources ??
    (locale.startsWith('zh')
      ? (['netease', 'kugou', 'ttmlDb', 'lrclib', 'lrcmux'] as const)
      : LYRICS_SOURCE_IDS);
  const allSources = [
    ...sources,
    ...LYRICS_SOURCE_IDS.filter((source) => !sources.includes(source)),
  ];
  return (
    <>
      <SettingsExpander
        icon={<TextSortAscending20Regular />}
        title={t('lyrics.priority')}
        field
        defaultOpen={false}
        control={(ids) => (
          <SettingsSelect
            {...ids}
            value={preset}
            options={[
              { value: 'local', label: t('lyrics.localFirst') },
              { value: 'word', label: t('lyrics.wordFirst') },
              { value: 'custom', label: t('lyrics.preset.custom'), disabled: true },
            ]}
            onChange={(value) => {
              if (value !== 'custom')
                void service.setOrder(value === 'local' ? LYRICS_PRIORITY : WORD_FIRST);
            }}
          />
        )}
      >
        {order.map((category, index) => (
          <SettingsRow key={category} title={t(`lyrics.priority.${category}`)}>
            {() => (
              <>
                <Button
                  appearance="subtle"
                  className={controls.icon}
                  icon={<ArrowUp16Regular />}
                  aria-label={t('lyrics.moveUp', { name: t(`lyrics.priority.${category}`) })}
                  disabled={index === 0}
                  onClick={() => void service.setOrder(reordered(order, index, -1))}
                />
                <Button
                  appearance="subtle"
                  className={controls.icon}
                  icon={<ArrowDown16Regular />}
                  aria-label={t('lyrics.moveDown', { name: t(`lyrics.priority.${category}`) })}
                  disabled={index === order.length - 1}
                  onClick={() => void service.setOrder(reordered(order, index, 1))}
                />
              </>
            )}
          </SettingsRow>
        ))}
      </SettingsExpander>
      <SettingsExpander
        icon={<Globe20Regular />}
        title={t('lyrics.online')}
        defaultOpen={false}
        control={(ids) => (
          <Switch
            aria-labelledby={ids.labelId}
            checked={pref.enabled}
            onChange={(_, data) => void service.setEnabled(data.checked, locale)}
          />
        )}
      >
        {allSources.map((source) => {
          const index = sources.indexOf(source);
          return (
            <SettingsRow key={source} title={t(`lyrics.source.${source}`)}>
              {(ids) => (
                <>
                  <Switch
                    aria-labelledby={ids.labelId}
                    checked={index >= 0}
                    onChange={(_, data) =>
                      void service.setSources(
                        data.checked ? [...sources, source] : sources.filter((id) => id !== source),
                      )
                    }
                  />
                  <Button
                    appearance="subtle"
                    className={controls.icon}
                    icon={<ArrowUp16Regular />}
                    aria-label={t('lyrics.moveUp', { name: t(`lyrics.source.${source}`) })}
                    disabled={index <= 0}
                    onClick={() => void service.setSources(reordered(sources, index, -1))}
                  />
                  <Button
                    appearance="subtle"
                    className={controls.icon}
                    icon={<ArrowDown16Regular />}
                    aria-label={t('lyrics.moveDown', { name: t(`lyrics.source.${source}`) })}
                    disabled={index < 0 || index === sources.length - 1}
                    onClick={() => void service.setSources(reordered(sources, index, 1))}
                  />
                </>
              )}
            </SettingsRow>
          );
        })}
      </SettingsExpander>
    </>
  );
}
