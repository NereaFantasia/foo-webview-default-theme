import { Button } from '@fluentui/react-components';
import {
  Checkmark16Regular,
  Copy16Regular,
  DocumentBulletList20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId } from 'react';
import { entries } from '../diagnostics/eventLog.ts';
import { diagnosticsAtom } from '../host/infoCenter.ts';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { pluralAtom } from '../i18n/plural.ts';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { runtimeLogReport, windowStateText } from './about.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { useCopyAction } from './useCopyAction.ts';

/**
 * 「关于」里的「运行日志」：说明行写内存里记了几条，「复制」把版本、窗口现状和这些记录放进剪贴板，报问题时
 * 直接贴。没读到宿主版本时也能复制，宿主过旧或不在时更需要它。条数在进页和复制时重数，不跟着日志实时变
 */
export function RuntimeLogCard() {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const diagnostics = useAtomValueRawSync(diagnosticsAtom);
  const viewControls = useViewControlStyles();
  const { outcome, copy } = useCopyAction();
  const buttonId = useId();
  const count = entries().length;
  const failed = outcome === 'failed';
  const status =
    count > 0
      ? t(plural(count, 'settings.runtimeLogCountOne', 'settings.runtimeLogCount'), { count })
      : t('settings.runtimeLogNone');

  return (
    <SettingsCard
      icon={<DocumentBulletList20Regular />}
      title={t('settings.runtimeLog')}
      description={failed ? t('settings.copyFailed') : status}
      error={failed}
    >
      {({ labelId, descriptionId }) => (
        <Button
          className={viewControls.field}
          id={buttonId}
          icon={outcome === 'copied' ? <Checkmark16Regular /> : <Copy16Regular />}
          iconPosition="after"
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() =>
            void copy(
              runtimeLogReport(
                diagnostics,
                windowStateText({
                  width: window.innerWidth,
                  height: window.innerHeight,
                  ratio: window.devicePixelRatio,
                  scheme,
                  locale,
                  userAgent: navigator.userAgent,
                }),
              ),
            )
          }
        >
          {t(outcome === 'copied' ? 'settings.copied' : 'settings.copy')}
        </Button>
      )}
    </SettingsCard>
  );
}
