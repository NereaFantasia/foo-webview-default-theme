import { Button, ProgressBar, Tooltip } from '@fluentui/react-components';
import { ArrowDownload20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PrimaryPlayButton } from '../../theme/PrimaryPlayButton.tsx';
import { ncmSetupKey } from '../search/online/ncmSetup.ts';
import { useHomeServices } from './homeContext.ts';
import styles from './HomeNcmSetup.module.css';

/**
 * 网易云组件没装时首页顶上的一张卡：写体积、来源与许可，点了才下；下载与安装中显示进度，失败写原因可重试，
 * 装好后在线的几行接着出。点过「不再显示」就不出；后端没有可下载的组件、或连不上时也不出
 */
export function HomeNcmSetup() {
  const t = useAtomValueRawSync(translateAtom);
  const { active } = useAtomValueRawSync(localeAtom);
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const missing = useAtomValueRawSync(home.online.missing);
  const dismissed = useAtomValueRawSync(home.online.setupDismissed);
  const setup = useService(ncmSetupKey);
  const state = useAtomValueRawSync(setup.state);
  const shown = missing && !dismissed;
  useEffect(() => {
    if (shown) setup.refresh();
  }, [shown, setup]);
  const installed = state.status === 'ready' && state.component.phase === 'installed';
  useEffect(() => {
    // 重读在线音乐状态，网易云可用后在线的几行就会取数
    if (installed) home.online.activate();
  }, [installed, home]);
  if (!shown || state.status !== 'ready' || installed) return null;
  const { component } = state;
  const pack = component.package;
  if (!pack) return null;
  const megabytes = new Intl.NumberFormat(active, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0,
  });
  const size = megabytes.format(pack.size / 1e6);
  const busy = component.phase === 'downloading' || component.phase === 'installing';
  const downloading = component.phase === 'downloading';
  const title = busy
    ? t(downloading ? 'online.downloading' : 'online.installing')
    : component.failure
      ? t(component.failure === 'download' ? 'online.downloadFailed' : 'online.installFailed')
      : t('home.ncmSetupTitle');
  return (
    <section
      className={styles.root}
      aria-label={t('home.ncmSetupTitle')}
      data-home-section="ncm-setup"
    >
      <div className={styles.text}>
        <span className={styles.title} role={busy ? 'status' : undefined}>
          {title}
        </span>
        {busy ? (
          <>
            <ProgressBar
              className={styles.progress}
              value={downloading && pack.size > 0 ? component.received / pack.size : undefined}
              thickness="medium"
              aria-label={title}
            />
            {downloading && (
              <span className={styles.detail}>
                {t('online.progress', {
                  received: megabytes.format(component.received / 1e6),
                  size,
                })}
              </span>
            )}
          </>
        ) : component.failure ? (
          <span className={styles.detail}>{t(`online.failure.${component.failure}`)}</span>
        ) : (
          <>
            <span className={styles.detail}>{t('home.ncmSetupDetail')}</span>
            <span className={styles.detail}>
              {t('online.setupDetail', { size, licenses: pack.licenses.join(', ') })}
            </span>
          </>
        )}
      </div>
      {!busy && (
        <PrimaryPlayButton icon={<ArrowDownload20Regular />} onClick={() => void setup.install()}>
          {component.failure ? t('album.retry') : t('home.ncmSetupDownload')}
        </PrimaryPlayButton>
      )}
      <Tooltip content={t('home.ncmSetupDismiss')} relationship="label">
        <Button
          appearance="subtle"
          className={viewControls.icon}
          icon={<Dismiss20Regular />}
          aria-label={t('home.ncmSetupDismiss')}
          onClick={home.online.dismissSetup}
        />
      </Tooltip>
    </section>
  );
}
