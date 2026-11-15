import { Switch } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import {
  BIOGRAPHY_LANGUAGES,
  type BiographyLanguagePreference,
  type BiographySource,
} from '../library/biography/biographyModel.ts';
import { BIOGRAPHY_SOURCES } from '../library/biography/biographySourcePrefs.ts';
import { localeName } from '../settings/localeName.ts';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { SettingsSelect, type SettingsOption } from '../settings/SettingsSelect.tsx';
import type { BiographyIntegration } from './biographyIntegration.ts';

const SOURCE_NAMES: Readonly<Record<BiographySource, string>> = {
  apple: 'Apple Music',
  lastfm: 'Last.fm',
};

/** Apple 页面只提供中文默认语言与英文，别的语言取英文 */
const APPLE_LANGUAGES: readonly BiographyLanguagePreference[] = ['auto', 'zh', 'en'];

/**
 * 「简介来源」：缺省 Apple Music。切换后所有艺人按新来源重新取，两个来源的缓存与手选互不影响
 */
export function BiographySourceRow({
  integration,
}: {
  readonly integration: BiographyIntegration;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(integration.prefs.state);
  const loaded = useAtomValueRawSync(integration.sourcePrefs.loaded);
  const source = useAtomValueRawSync(integration.sourcePrefs.source);
  const options: readonly SettingsOption<BiographySource>[] = BIOGRAPHY_SOURCES.map((value) => ({
    value,
    label: SOURCE_NAMES[value],
  }));
  return (
    <SettingsRow title={t('biography.sourceChoice')} disabled={!prefs.enabled} field>
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={options}
          value={source}
          disabled={!loaded || !prefs.enabled}
          onChange={(value) => void integration.sourcePrefs.setSource(value)}
        />
      )}
    </SettingsRow>
  );
}

/**
 * 「Apple Music 没有简介时改用 Last.fm」：缺省关，只在来源是 Apple 时出现。打开后 Apple 没有简介的艺人
 * 改取 Last.fm 的正文，隐私说明与 Last.fm 密钥行随之出现
 */
export function BiographyFallbackRow({
  integration,
}: {
  readonly integration: BiographyIntegration;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(integration.prefs.state);
  const loaded = useAtomValueRawSync(integration.sourcePrefs.loaded);
  const source = useAtomValueRawSync(integration.sourcePrefs.source);
  const on = useAtomValueRawSync(integration.sourcePrefs.lastfmFallback);
  if (source !== 'apple') return null;
  return (
    <SettingsRow title={t('biography.lastfmFallback')} disabled={!prefs.enabled}>
      {({ labelId }) => (
        <Switch
          checked={on}
          disabled={!loaded || !prefs.enabled}
          aria-labelledby={labelId}
          onChange={(_, data) => void integration.sourcePrefs.setLastfmFallback(data.checked)}
        />
      )}
    </SettingsRow>
  );
}

/**
 * 「动态艺术照」：缺省开，只在来源是 Apple 时出现。艺人页头部有 Apple 提供的动态艺术照时，静帧载完之后静音循环播放；
 * 关着时只显示静帧。开关随这台机器记住；在线内容关着时禁用
 */
export function BiographyMotionRow({
  integration,
}: {
  readonly integration: BiographyIntegration;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(integration.prefs.state);
  const source = useAtomValueRawSync(integration.sourcePrefs.source);
  const on = useAtomValueRawSync(integration.motionEnabled);
  if (source !== 'apple') return null;
  return (
    <SettingsRow title={t('biography.motion')} disabled={!prefs.enabled}>
      {({ labelId }) => (
        <Switch
          checked={on}
          disabled={!prefs.enabled}
          aria-labelledby={labelId}
          onChange={(_, data) => integration.setMotion(data.checked)}
        />
      )}
    </SettingsRow>
  );
}

/**
 * 「简介语言」行：Apple 来源仅支持跟随界面语言、中文与 English 三项
 * 若当前偏好不在支持列表中，界面回退至 English 并向 Apple 请求英文简介
 */
export function BiographyLanguageRow({
  integration,
}: {
  readonly integration: BiographyIntegration;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const prefs = useAtomValueRawSync(integration.prefs.state);
  const source = useAtomValueRawSync(integration.sourcePrefs.source);
  const all: readonly BiographyLanguagePreference[] = ['auto', ...BIOGRAPHY_LANGUAGES];
  const choices = source === 'apple' ? APPLE_LANGUAGES : all;
  const options: readonly SettingsOption<BiographyLanguagePreference>[] = choices.map((value) => ({
    value,
    label: value === 'auto' ? t('biography.followLanguage') : localeName(value),
  }));
  const shown = choices.includes(prefs.language) ? prefs.language : 'en';
  return (
    <SettingsRow title={t('biography.language')} disabled={!prefs.enabled} field>
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={options}
          value={shown}
          disabled={!prefs.loaded || prefs.busy || !prefs.enabled}
          onChange={(value) => integration.prefs.setLanguage(value)}
        />
      )}
    </SettingsRow>
  );
}
