import { Spinner, Tooltip } from '@fluentui/react-components';
import {
  CheckmarkCircle16Filled,
  DismissCircle16Filled,
  QuestionCircle16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useReducer } from 'react';
import { localeAtom, translateAtom } from '../i18n/locale.ts';
import type { MusicLxSource } from '../server/musicLxSources.ts';
import type { MusicPlatform } from '../server/musicObjects.ts';
import {
  healthLabel,
  healthState,
  healthTip,
  lastCheckedAt,
  relativeTime,
  type LxHealthState,
} from './lxHealthText.ts';
import styles from './LxPlatformStatus.module.css';

interface LxPlatformStatusProps {
  readonly platforms: readonly MusicPlatform[];
  readonly health: MusicLxSource['health'];
  /** 正在执行连通性检测的目标平台集合 */
  readonly checking: ReadonlySet<MusicPlatform>;
}

function StateIcon({ state }: { readonly state: LxHealthState }) {
  switch (state) {
    case 'checking':
      return (
        <span className={styles.spinner}>
          <Spinner size="extra-tiny" />
        </span>
      );
    case 'ok':
      return <CheckmarkCircle16Filled className={`${styles.icon} ${styles.ok}`} />;
    case 'failed':
      return <DismissCircle16Filled className={`${styles.icon} ${styles.failed}`} />;
    case 'unknown':
      return <QuestionCircle16Regular className={`${styles.icon} ${styles.unknown}`} />;
    case 'none':
      return null;
  }
}

/**
 * 音源平台健康度状态指示器，展示各平台连通状态与最近一次检测的相对时间
 *
 * 相对时间每分钟定时刷新一次
 */
export function LxPlatformStatus({ platforms, health, checking }: LxPlatformStatusProps) {
  const t = useAtomValueRawSync(translateAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = Date.now();
  const checkedAt = lastCheckedAt(health, platforms);
  return (
    <span className={styles.items}>
      {platforms.map((platform) => {
        const result = health[platform];
        const busy = checking.has(platform);
        const state = healthState(result, busy);
        const name = t(`online.platform.${platform}`);
        const tip = busy ? null : healthTip(t, locale, result, now);
        const item = (
          <span
            className={styles.item}
            role="img"
            tabIndex={0}
            aria-label={healthLabel(t, name, result, busy)}
          >
            <StateIcon state={state} />
            <span aria-hidden="true">{name}</span>
          </span>
        );
        return tip ? (
          <Tooltip key={platform} content={tip} relationship="description">
            {item}
          </Tooltip>
        ) : (
          <span key={platform}>{item}</span>
        );
      })}
      {checkedAt !== null && (
        <span
          className={styles.checked}
          title={new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(checkedAt)}
        >
          {t('online.lxCheckedAt', { when: relativeTime(t, locale, checkedAt, now) })}
        </span>
      )}
    </span>
  );
}
