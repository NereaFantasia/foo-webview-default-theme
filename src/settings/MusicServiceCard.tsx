import { Button } from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  Box16Regular,
  Checkmark16Regular,
  CheckmarkCircle16Regular,
  Cloud16Regular,
  Copy16Regular,
  ErrorCircle16Regular,
  Hexagon16Regular,
  MusicNote216Regular,
  Person16Regular,
  PlugConnected16Regular,
  PlugDisconnected16Regular,
  Pulse20Regular,
  PuzzlePiece16Regular,
  Server16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import { Metadata, MetadataItem } from '../kit/Metadata.tsx';
import { useService } from '../kit/useService.ts';
import { musicClientKey } from '../playback/musicClient.ts';
import { musicStatusKey } from '../playback/musicStatus.ts';
import { failureReason, onlineFailuresAtom } from '../playback/onlineFailures.ts';
import { onlineKey, onlineTracksAtom } from '../playback/onlineTracks.ts';
import { backendStateKey } from '../server/backendConnection.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { musicServiceReport } from './about.ts';
import styles from './MusicServiceCard.module.css';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { useCopyAction } from './useCopyAction.ts';

const NCM_ICONS = {
  missing: <ArrowDownload16Regular />,
  installed: <CheckmarkCircle16Regular />,
  loaded: <CheckmarkCircle16Regular />,
  failed: <ErrorCircle16Regular />,
} as const;

/** 一行的值：照 28G 分两行、靠右，每项前面一个图标 */
function Value({ lines }: { readonly lines: readonly ReactNode[] }) {
  return (
    <div className={styles.value}>
      {lines.map((line, index) => (
        <Metadata key={index}>{line}</Metadata>
      ))}
    </div>
  );
}

/**
 * 「关于」里的「在线音乐服务」：后端、网易云组件、lxserver（配置了才出）与最近一次播放失败，只读，排障时用
 * 卡头写正常或不可用，「复制」把这些放进剪贴板（`musicServiceReport`）。进页时重读一次在线音乐状态与组件版本，
 * 不轮询；后端连接与播放失败本来就跟着变
 */
export function MusicServiceCard() {
  const t = useAtomValueRawSync(translateAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const viewControls = useViewControlStyles();
  const backend = useService(backendStateKey);
  const port = useAtomValueRawSync(backend.port);
  const failed = useAtomValueRawSync(backend.failed);
  const health = useAtomValueRawSync(backend.health);
  const status = useService(musicStatusKey);
  const state = useAtomValueRawSync(status.state);
  const client = useService(musicClientKey);
  const failures = useAtomValueRawSync(onlineFailuresAtom);
  const tracks = useAtomValueRawSync(onlineTracksAtom);
  const [ncmVersion, setNcmVersion] = useState<string | null>(null);
  const { outcome, copy } = useCopyAction();
  const buttonId = useId();
  const connected = port !== null && !failed;
  const music = state.status === 'ready' ? state.music : null;
  const lastFailure = failures.at(-1) ?? null;

  useEffect(() => status.refresh(), [status]);
  // 组件装好或加载失败后，登记的版本才有用；阶段一变就再问一次
  const phase = music?.ncm ?? null;
  useEffect(() => {
    if (!connected || phase === null) return;
    const request = new AbortController();
    client.ncm({ signal: request.signal }).then(
      (ncm) => setNcmVersion(ncm.package?.version ?? null),
      () => {},
    );
    return () => request.abort();
  }, [client, connected, phase]);

  const snapshot = {
    port: connected ? port : null,
    health: connected ? health : null,
    music: connected ? music : null,
    ncmVersion,
    lastFailure,
  };
  // 连着、还在读第一次时不写，免得进页先闪一下不对的状态
  const preview =
    !connected || state.status === 'failed'
      ? t('online.serviceDown')
      : music
        ? t('online.serviceReady')
        : null;
  const copyFailed = outcome === 'failed';
  const lx = snapshot.music && snapshot.music.lx !== 'unconfigured' ? snapshot.music : null;
  const others = lx?.platforms.filter((platform) => platform !== 'wy') ?? [];

  return (
    <SettingsExpander
      icon={<Pulse20Regular />}
      title={t('online.service')}
      description={copyFailed ? t('settings.copyFailed') : undefined}
      error={copyFailed}
      preview={preview && <span className={styles.status}>{preview}</span>}
      control={({ labelId, descriptionId }) => (
        <Button
          className={viewControls.field}
          id={buttonId}
          icon={outcome === 'copied' ? <Checkmark16Regular /> : <Copy16Regular />}
          iconPosition="after"
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={descriptionId}
          onClick={() => void copy(musicServiceReport(snapshot))}
        >
          {t(outcome === 'copied' ? 'settings.copied' : 'settings.copy')}
        </Button>
      )}
    >
      <SettingsRow title={t('online.serviceBackend')}>
        {() => (
          <Value
            lines={[
              <>
                <MetadataItem
                  icon={connected ? <PlugConnected16Regular /> : <PlugDisconnected16Regular />}
                >
                  {t(connected ? 'online.serviceConnected' : 'online.serviceDisconnected')}
                </MetadataItem>
                {snapshot.port !== null && (
                  <MetadataItem icon={<Server16Regular />} label={t('online.serviceAddress')}>
                    127.0.0.1:{snapshot.port}
                  </MetadataItem>
                )}
              </>,
              snapshot.health && (
                <>
                  <MetadataItem icon={<Box16Regular />} label={t('online.serviceBackendVersion')}>
                    {snapshot.health.version}
                  </MetadataItem>
                  <MetadataItem icon={<Hexagon16Regular />}>
                    {t('online.serviceRuntime', { version: snapshot.health.runtime })}
                  </MetadataItem>
                </>
              ),
            ]}
          />
        )}
      </SettingsRow>
      {snapshot.music && (
        <SettingsRow title={t('online.serviceComponent')}>
          {() =>
            snapshot.music && (
              <Value
                lines={[
                  <>
                    <MetadataItem icon={NCM_ICONS[snapshot.music.ncm]}>
                      {t(`online.serviceNcm.${snapshot.music.ncm}`)}
                    </MetadataItem>
                    {snapshot.music.ncm !== 'missing' && ncmVersion && (
                      <MetadataItem
                        icon={<Box16Regular />}
                        label={t('online.serviceComponentVersion')}
                      >
                        {ncmVersion}
                      </MetadataItem>
                    )}
                  </>,
                  <>
                    <MetadataItem icon={<Person16Regular />}>
                      {t(
                        snapshot.music.account
                          ? 'online.serviceSignedIn'
                          : 'online.serviceSignedOut',
                      )}
                    </MetadataItem>
                    <MetadataItem icon={<PuzzlePiece16Regular />}>
                      {t(
                        snapshot.music.unblock
                          ? 'online.serviceUnblockOn'
                          : 'online.serviceUnblockOff',
                      )}
                    </MetadataItem>
                  </>,
                ]}
              />
            )
          }
        </SettingsRow>
      )}
      {lx && (
        <SettingsRow title={t('online.serviceLx')}>
          {() => (
            <Value
              lines={[
                lx.lxServer && (
                  <MetadataItem icon={<Server16Regular />} label={t('online.serviceAddress')}>
                    {lx.lxServer.url}
                  </MetadataItem>
                ),
                <MetadataItem
                  icon={lx.lx === 'ready' ? <Cloud16Regular /> : <ErrorCircle16Regular />}
                  label={lx.lx === 'ready' ? t('online.servicePlatforms') : undefined}
                >
                  {lx.lx === 'invalid-config'
                    ? t('online.serviceLxInvalid')
                    : lx.lx === 'catalog-unavailable'
                      ? t('online.serviceLxCatalog')
                      : others.length
                        ? new Intl.ListFormat(locale, {
                            type: 'conjunction',
                            style: 'narrow',
                          }).format(others.map((platform) => t(`online.platform.${platform}`)))
                        : t('online.serviceLxNone')}
                </MetadataItem>,
              ]}
            />
          )}
        </SettingsRow>
      )}
      {lastFailure && (
        <SettingsRow title={t('online.serviceLastFailure')}>
          {() => (
            <Value
              lines={[
                <>
                  <MetadataItem icon={<MusicNote216Regular />} label={t('online.serviceTrack')}>
                    {tracks.get(onlineKey(lastFailure.ref))?.title ?? t('online.unknownTitle')}
                  </MetadataItem>
                  <MetadataItem icon={<Cloud16Regular />} label={t('online.servicePlatforms')}>
                    {t(`online.platform.${lastFailure.ref.platform}`)}
                  </MetadataItem>
                </>,
                <MetadataItem icon={<ErrorCircle16Regular />} label={t('online.serviceReason')}>
                  {failureReason(t, lastFailure)}
                </MetadataItem>,
              ]}
            />
          )}
        </SettingsRow>
      )}
    </SettingsExpander>
  );
}
