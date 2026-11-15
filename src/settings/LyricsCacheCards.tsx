import { Button, Switch } from '@fluentui/react-components';
import { Bookmark20Regular, Database20Regular, Delete20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translate.ts';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_CACHE_PREF_KEY,
  lyricsCacheKey,
  type LyricsCacheUsage,
} from '../lyrics/lyricsCache.ts';
import { LYRICS_CACHE_LIMITS_MB } from '../server/lyricsCacheProtocol.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';

const MIB = 1024 * 1024;
const LIMIT_OPTIONS = LYRICS_CACHE_LIMITS_MB.map((value) => ({
  value: String(value),
  label: `${value} MiB`,
}));

/** 设置 ›「歌词」里的「选用歌词时默认记住」 */
export function LyricsRememberCard() {
  const t = useAtomValueRawSync(translateAtom);
  const cache = useService(lyricsCacheKey);
  const pref = useAtomValueRawSync(cache.pref);
  return (
    <SettingsCard icon={<Bookmark20Regular />} title={t('lyrics.rememberOnUse')}>
      {({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={pref.remember}
          onChange={(_, data) => void cache.setRemember(data.checked)}
        />
      )}
    </SettingsCard>
  );
}

/** 设置 ›「常规」›「数据」里的歌词缓存（开关、上限、清理）。本地服务没连着时不可操作 */
export function LyricsCacheCard() {
  const t = useAtomValueRawSync(translateAtom);
  const cache = useService(lyricsCacheKey);
  const pref = useAtomValueRawSync(cache.pref);
  const available = useAtomValueRawSync(cache.available);
  const usage = useAtomValueRawSync(cache.usage);
  const controls = useViewControlStyles();
  useEffect(() => {
    if (available) void cache.refreshUsage();
  }, [cache, available]);
  const failed = available && (usage.status === 'failed' || usage.status === 'clear-failed');
  const busy = usage.status === 'loading' || usage.status === 'clearing';
  const summary = !available ? t('lyrics.cacheUnavailable') : usageText(usage, t);
  return (
    <SettingsExpander
      icon={<Database20Regular />}
      title={t('lyrics.cache')}
      description={summary}
      error={failed}
      defaultOpen={false}
      feedback={
        <SettingsSaveNotice persistence={cache.persistence} keys={[LYRICS_CACHE_PREF_KEY]} />
      }
      control={({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={pref.enabled}
          disabled={!available}
          onChange={(_, data) => void cache.setEnabled(data.checked)}
        />
      )}
    >
      <SettingsRow title={t('lyrics.cacheLimit')} field disabled={!available}>
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={String(pref.limitMb)}
            options={LIMIT_OPTIONS}
            disabled={!available}
            onChange={(value) => {
              const limit = LYRICS_CACHE_LIMITS_MB.find((item) => String(item) === value);
              if (limit) void cache.setLimit(limit);
            }}
          />
        )}
      </SettingsRow>
      <SettingsRow
        title={t('lyrics.cachedLyrics')}
        description={t('lyrics.cacheKeep')}
        disabled={!available}
      >
        {() => (
          <Button
            className={controls.field}
            icon={<Delete20Regular />}
            disabled={!available || busy}
            onClick={() => void cache.clear()}
          >
            {t('lyrics.clearCache')}
          </Button>
        )}
      </SettingsRow>
    </SettingsExpander>
  );
}

function usageText(usage: LyricsCacheUsage, t: Translate): string {
  switch (usage.status) {
    case 'loading':
      return t('lyrics.cacheLoading');
    case 'clearing':
      return t('lyrics.cacheClearing');
    case 'failed':
      return t('lyrics.cacheReadFailed');
    case 'clear-failed':
      return t('lyrics.cacheClearFailed');
    case 'ready': {
      const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
        usage.bytes / MIB,
      );
      return t(usage.count === 1 ? 'lyrics.cacheUsageOne' : 'lyrics.cacheUsage', {
        count: usage.count,
        size,
      });
    }
  }
}
