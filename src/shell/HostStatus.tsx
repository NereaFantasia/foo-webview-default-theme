import { Caption1, makeStyles } from '@fluentui/react-components';
import { Warning16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import {
  loadHostInfo,
  REQUIRED_HOST_VERSION,
  versionAtLeast,
  type HostInfo,
} from '../host/hostInfo.ts';
import { translateAtom } from '../i18n/locale.ts';
import styles from './HostStatus.module.css';

const useStyles = makeStyles({
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/**
 * 宿主版本核对，放在标题栏里：读不到版本、版本低于 `REQUIRED_HOST_VERSION` 时显示一行提示；版本满足、
 * 等不到宿主（普通浏览器里打开）时什么都不显示。提示区常在、平时是空的，核对还没有结果时标
 * `aria-busy`，读屏在结果出来后才念。
 */
export function HostStatus() {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const [info, setInfo] = useState<HostInfo | null>(null);

  useEffect(() => {
    let current = true;
    void loadHostInfo().then((next) => {
      if (current) setInfo(next);
    });
    return () => {
      current = false;
    };
  }, []);

  let message: string | null = null;
  if (info?.state === 'failed') message = t('host.readFailed');
  else if (
    info?.state === 'connected' &&
    !versionAtLeast(info.pluginVersion, REQUIRED_HOST_VERSION)
  ) {
    message = t('host.tooOld', { version: info.pluginVersion, required: REQUIRED_HOST_VERSION });
  }
  return (
    <span className={styles.root} role="status" aria-busy={info === null || undefined}>
      {message !== null && (
        <>
          <Warning16Regular />
          <Caption1 className={classes.text}>{message}</Caption1>
        </>
      )}
    </span>
  );
}
