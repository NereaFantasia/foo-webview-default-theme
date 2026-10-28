import { Body1, Button, ProgressBar, Subtitle2 } from '@fluentui/react-components';
import {
  ArrowDownload48Regular,
  ErrorCircle48Regular,
  PlugDisconnected48Regular,
  Search48Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { localeAtom, translateAtom } from '../../../i18n/locale.ts';
import { useService } from '../../../kit/useService.ts';
import { platformName } from '../../../playback/musicPlatforms.ts';
import { musicStatusKey } from '../../../playback/musicStatus.ts';
import type { MusicPlatform } from '../../../server/musicObjects.ts';
import { ncmSetupKey } from './ncmSetup.ts';
import styles from './OnlineEmpty.module.css';

/** 空态的一格：图标、标题、可选的说明与一个主操作 */
export function OnlineMessage({
  icon,
  title,
  detail,
  action,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail?: string;
  readonly action?: { readonly label: string; readonly run: () => void };
  readonly children?: ReactNode;
}) {
  return (
    <div className={styles.root} role="status" data-online-empty>
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
      <Subtitle2>{title}</Subtitle2>
      {detail && <Body1 className={styles.detail}>{detail}</Body1>}
      {children}
      {action && (
        <Button appearance="primary" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** 连不上在线音乐服务：媒体库不受影响。重试先让后端重连，再交给调用方重发它自己的请求 */
export function OnlineUnavailable({ onRetry }: { onRetry(): void }) {
  const t = useAtomValueRawSync(translateAtom);
  const status = useService(musicStatusKey);
  return (
    <OnlineMessage
      icon={<PlugDisconnected48Regular />}
      title={t('online.unavailableTitle')}
      detail={t('online.unavailableDetail')}
      action={{ label: t('album.retry'), run: () => void status.reconnect().then(onRetry) }}
    />
  );
}

export function OnlineSearchFailed({
  platform,
  onRetry,
}: {
  readonly platform: MusicPlatform;
  onRetry(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <OnlineMessage
      icon={<ErrorCircle48Regular />}
      title={t('online.searchFailed', { platform: platformName(t, platform) })}
      action={{ label: t('album.retry'), run: onRetry }}
    />
  );
}

export function OnlineNoResults({
  platform,
  text,
}: {
  readonly platform: MusicPlatform;
  readonly text: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <OnlineMessage
      icon={<Search48Regular />}
      title={t('online.noResults', { platform: platformName(t, platform), text })}
    />
  );
}

/**
 * 网易云组件还没装好时的空态：未下载时写体积、来源与许可，点了才下；下载与安装中显示进度；失败写原因可重试
 * 显示时重读一次状态；装好后调 `onReady`，由调用方重发被组件挡下的请求
 */
export function NcmSetupPanel({ onReady }: { onReady(): void }) {
  const t = useAtomValueRawSync(translateAtom);
  const { active } = useAtomValueRawSync(localeAtom);
  const setup = useService(ncmSetupKey);
  const state = useAtomValueRawSync(setup.state);
  const ready = useRef(onReady);
  useLayoutEffect(() => {
    ready.current = onReady;
  });
  useEffect(() => setup.refresh(), [setup]);
  const installed = state.status === 'ready' && state.component.phase === 'installed';
  useEffect(() => {
    if (installed) ready.current();
  }, [installed]);
  if (state.status === 'failed') return <OnlineUnavailable onRetry={() => setup.refresh()} />;
  if (state.status !== 'ready' || installed) return null;
  const { component } = state;
  const megabytes = new Intl.NumberFormat(active, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0,
  });
  const size = component.package ? megabytes.format(component.package.size / 1e6) : '';
  if (component.phase === 'downloading' || component.phase === 'installing') {
    const total = component.package?.size ?? 0;
    const downloading = component.phase === 'downloading';
    return (
      <OnlineMessage
        icon={<ArrowDownload48Regular />}
        title={t(downloading ? 'online.downloading' : 'online.installing')}
      >
        <ProgressBar
          className={styles.progress}
          value={downloading && total > 0 ? component.received / total : undefined}
          thickness="medium"
          aria-label={t(downloading ? 'online.downloading' : 'online.installing')}
        />
        {downloading && total > 0 && (
          <Body1 className={styles.detail}>
            {t('online.progress', {
              received: megabytes.format(component.received / 1e6),
              size,
            })}
          </Body1>
        )}
      </OnlineMessage>
    );
  }
  if (!component.package)
    return (
      <OnlineMessage
        icon={<ErrorCircle48Regular />}
        title={t('online.unavailableTitle')}
        detail={t('online.noPackage')}
      />
    );
  if (component.failure)
    return (
      <OnlineMessage
        icon={<ErrorCircle48Regular />}
        title={t(
          component.failure === 'download' ? 'online.downloadFailed' : 'online.installFailed',
        )}
        detail={t(`online.failure.${component.failure}`)}
        action={{ label: t('album.retry'), run: () => void setup.install() }}
      />
    );
  return (
    <OnlineMessage
      icon={<ArrowDownload48Regular />}
      title={t('online.setupTitle')}
      detail={t('online.setupDetail', {
        size,
        licenses: component.package.licenses.join(', '),
      })}
      action={{ label: t('online.download'), run: () => void setup.install() }}
    />
  );
}
