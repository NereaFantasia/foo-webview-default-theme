import { Button } from '@fluentui/react-components';
import {
  Box20Regular,
  Checkmark16Regular,
  Copy16Regular,
  Open16Regular,
  Scales20Regular,
  Box16Regular,
  Color16Regular,
  MusicNote216Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext, useId } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { diagnosticsAtom } from '../host/infoCenter.ts';
import { LICENSE_URL, THEME_VERSION, versionReport } from './about.ts';
import { CreditsCard } from './CreditsCard.tsx';
import { MusicServiceCard } from './MusicServiceCard.tsx';
import { openExternal } from './hostActions.ts';
import { RuntimeLogCard } from './RuntimeLogCard.tsx';
import { SettingsActionCard } from './SettingsActionCard.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { useHostAbsent } from './useHostAbsent.ts';
import { useCopyAction } from './useCopyAction.ts';
import { UpdateSettingsContext } from './updateSettingsContext.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';
import styles from './AboutSection.module.css';

/**
 * 版本分组显示；「复制」把它们连同构建信息放进剪贴板，报问题时直接贴
 * 读到版本之前复制禁用：确定没有宿主时说明行写明原因，还在连、读取失败时是一道横线
 */
function VersionCard() {
  const viewControls = useViewControlStyles();
  const t = useAtomValueRawSync(translateAtom);
  const diagnostics = useAtomValueRawSync(diagnosticsAtom);
  const absent = useHostAbsent();
  const { outcome, copy } = useCopyAction();
  const buttonId = useId();

  const line = diagnostics ? undefined : absent ? t('settings.needsHost') : '—';
  const failed = outcome === 'failed' && diagnostics !== null;
  return (
    <SettingsCard
      icon={<Box20Regular />}
      title={t('settings.version')}
      description={failed ? t('settings.copyFailed') : line}
      error={failed}
      feedback={
        diagnostics && !failed ? (
          <Metadata className={styles.versions}>
            <MetadataItem icon={<Color16Regular />}>
              {t('settings.versionTheme', { version: THEME_VERSION })}
            </MetadataItem>
            <MetadataItem icon={<Box16Regular />}>
              {diagnostics.pluginName} {diagnostics.pluginVersion}
            </MetadataItem>
            <MetadataItem icon={<MusicNote216Regular />}>
              {t('settings.versionBuild', {
                foobar: diagnostics.foobar2000,
                bits: diagnostics.is64bit ? 64 : 32,
              })}
            </MetadataItem>
          </Metadata>
        ) : undefined
      }
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
          onClick={() => {
            if (diagnostics) void copy(versionReport(diagnostics));
          }}
        >
          {t(outcome === 'copied' ? 'settings.copied' : 'settings.copy')}
        </Button>
      )}
    </SettingsCard>
  );
}

function UpdateSettings() {
  return useContext(UpdateSettingsContext);
}

/** 「关于」一组：版本、运行日志、在线音乐服务的状态、主题更新、开源许可与致谢 */
export function AboutSection() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <>
      <VersionCard />
      <RuntimeLogCard />
      <MusicServiceCard />
      <UpdateSettings />
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
