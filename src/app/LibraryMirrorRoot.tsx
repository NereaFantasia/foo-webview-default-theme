import { Button, Switch } from '@fluentui/react-components';
import { ArrowSync20Regular, Database20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, type ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { pluralAtom, type PluralPick } from '../i18n/plural.ts';
import type { Translate } from '../i18n/translate.ts';
import { useService } from '../kit/useService.ts';
import {
  LIBRARY_MIRROR_PREF_KEY,
  libraryMirrorKey,
  type LibraryMirrorUsage,
} from '../library/mirror/libraryMirror.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { SettingsExpander } from '../settings/SettingsExpander.tsx';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { SettingsSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { LibraryMirrorSettingsContext } from '../settings/libraryMirrorSettingsContext.ts';

const MIB = 1024 * 1024;

/**
 * 「常规」里的媒体库缓存：开关、占用（曲目数与磁盘大小）和重建。缓存放在本地服务里，关着时歌曲、专辑等页面
 * 照旧向 foobar2000 取数。本地服务没连着时开关和重建不可操作
 */
function LibraryMirrorCard() {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const mirror = useService(libraryMirrorKey);
  const enabled = useAtomValueRawSync(mirror.enabled);
  const available = useAtomValueRawSync(mirror.available);
  const usage = useAtomValueRawSync(mirror.usage);
  const sync = useAtomValueRawSync(mirror.syncState);
  const controls = useViewControlStyles();
  useEffect(() => {
    void mirror.refreshUsage();
  }, [mirror, available, enabled, sync.phase, sync.generation]);
  const failed = available && (usage.status === 'failed' || usage.status === 'rebuild-failed');
  const building = enabled && usage.status === 'ready' && !usage.built;
  const summary = !available
    ? t('libraryMirror.unavailable')
    : usageText(usage, building, t, plural);
  const busy = building || sync.phase === 'syncing';
  return (
    <SettingsExpander
      icon={<Database20Regular />}
      title={t('libraryMirror.title')}
      description={summary}
      error={failed}
      defaultOpen={false}
      feedback={
        <SettingsSaveNotice persistence={mirror.persistence} keys={[LIBRARY_MIRROR_PREF_KEY]} />
      }
      control={({ labelId, descriptionId }) => (
        <Switch
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={enabled}
          disabled={!available}
          onChange={(_, data) => void mirror.setEnabled(data.checked)}
        />
      )}
    >
      <SettingsRow title={t('libraryMirror.cached')} disabled={!available || !enabled}>
        {() => (
          <Button
            className={controls.field}
            icon={<ArrowSync20Regular />}
            disabled={!available || !enabled || busy}
            onClick={() => void mirror.rebuild()}
          >
            {t('libraryMirror.rebuild')}
          </Button>
        )}
      </SettingsRow>
    </SettingsExpander>
  );
}

function usageText(
  usage: LibraryMirrorUsage,
  building: boolean,
  t: Translate,
  plural: PluralPick,
): string {
  switch (usage.status) {
    case 'loading':
      return t('libraryMirror.loading');
    case 'failed':
      return t('libraryMirror.readFailed');
    case 'rebuild-failed':
      return t('libraryMirror.rebuildFailed');
    case 'ready': {
      if (building) return t('libraryMirror.building');
      const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
        usage.bytes / MIB,
      );
      return t(plural(usage.count, 'libraryMirror.usageOne', 'libraryMirror.usage'), {
        count: usage.count,
        size,
      });
    }
  }
}

/** 把媒体库缓存卡放进设置页「常规」的插槽；设置页不认识媒体库镜像，服务由装配层提供 */
export function LibraryMirrorRoot({ children }: { readonly children: ReactNode }) {
  return (
    <LibraryMirrorSettingsContext value={<LibraryMirrorCard />}>
      {children}
    </LibraryMirrorSettingsContext>
  );
}
