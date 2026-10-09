import { Button } from '@fluentui/react-components';
import {
  Alert20Regular,
  ArrowCounterclockwise16Regular,
  Box20Regular,
  Checkmark16Regular,
  Copy16Regular,
  Open16Regular,
  Scales20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { diagnosticsAtom, dismissedCountAtom, infoCenterKey } from '../host/infoCenter.ts';
import { LICENSE_URL, THEME_VERSION, versionReport } from './about.ts';
import { CreditsCard } from './CreditsCard.tsx';
import { copyText, openExternal } from './hostActions.ts';
import { SettingsActionCard } from './SettingsActionCard.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { useHostAbsent } from './useHostAbsent.ts';
import { useService } from '../kit/useService.ts';
import { SettingsSaveNotice } from './SettingsSaveNotice.tsx';
import { UpdateSettingsContext } from './updateSettingsContext.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

/** 「已复制」在按钮上留多久，毫秒。 */
const COPIED_MS = 2000;

/**
 * 版本：主题、组件与 foobar2000 三个版本写成一行，「复制」把它们连同构建信息放进剪贴板，报问题时直接贴。
 * 读到版本之前复制禁用：确定没有宿主时说明行写明原因，还在连、读取失败时是一道横线。
 */
function VersionCard() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const diagnostics = useAtomValueRawSync(diagnosticsAtom);
  const absent = useHostAbsent();
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 复制的应答可能在离开设置页之后才回来，那时不再改状态、不再起定时器。
  const alive = useRef(false);
  const buttonId = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    if (!diagnostics) return;
    const done = await copyText(versionReport(diagnostics));
    if (!alive.current) return;
    clearTimeout(timer.current);
    setOutcome(done ? 'copied' : 'failed');
    if (done) timer.current = setTimeout(() => setOutcome('idle'), COPIED_MS);
  };

  const line = diagnostics
    ? [
        t('settings.versionTheme', { version: THEME_VERSION }),
        `${diagnostics.pluginName} ${diagnostics.pluginVersion}`,
        t('settings.versionBuild', {
          foobar: diagnostics.foobar2000,
          bits: diagnostics.is64bit ? 64 : 32,
        }),
      ].join(' · ')
    : absent
      ? t('settings.needsHost')
      : '—';
  const failed = outcome === 'failed' && diagnostics !== null;
  return (
    <SettingsCard
      icon={<Box20Regular />}
      title={t('settings.version')}
      description={failed ? t('settings.copyFailed') : line}
      error={failed}
    >
      {({ labelId, descriptionId }) => (
        <Button
          className={viewControls.field}
          id={buttonId}
          icon={outcome === 'copied' ? <Checkmark16Regular /> : <Copy16Regular />}
          iconPosition="after"
          disabled={!diagnostics}
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() => void copy()}
        >
          {t(outcome === 'copied' ? 'settings.copied' : 'settings.copy')}
        </Button>
      )}
    </SettingsCard>
  );
}

/**
 * 点过「不再提示」的提醒：写出还记着几条，「恢复」把它们全忘掉，问题还在的随即重新提示。一条都没记时
 * 按钮禁用但仍能接焦点：刚按过「恢复」，条数归零、按钮随之禁用，焦点要留在它上面，不能掉到 body。
 */
function RemindersCard() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const count = useAtomValueRawSync(dismissedCountAtom);
  const infoCenter = useService(infoCenterKey);
  const saving = useAtomValueRawSync(infoCenter.persistence.state);
  const buttonId = useId();
  return (
    <SettingsCard
      icon={<Alert20Regular />}
      title={t('settings.reminders')}
      feedback={
        <SettingsSaveNotice persistence={infoCenter.persistence} keys={[...saving.keys()]} />
      }
      description={
        count > 0 ? t('settings.remindersCount', { count }) : t('settings.remindersNone')
      }
    >
      {({ labelId, descriptionId }) => (
        <Button
          className={viewControls.field}
          id={buttonId}
          icon={<ArrowCounterclockwise16Regular />}
          iconPosition="after"
          disabledFocusable={count === 0}
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() => infoCenter.restoreReminders()}
        >
          {t('settings.restore')}
        </Button>
      )}
    </SettingsCard>
  );
}

function UpdateSettings() {
  return useContext(UpdateSettingsContext);
}

/** 「关于」一组：版本、主题更新、已关闭的提醒、开源许可与致谢。 */
export function AboutSection() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <>
      <VersionCard />
      <UpdateSettings />
      <RemindersCard />
      <SettingsActionCard
        icon={<Scales20Regular />}
        title={t('settings.license')}
        description="AGPL-3.0-only"
        label={t('settings.licenseView')}
        buttonIcon={<Open16Regular />}
        failedText="settings.openFailed"
        run={() => openExternal(LICENSE_URL)}
      />
      <CreditsCard />
    </>
  );
}
