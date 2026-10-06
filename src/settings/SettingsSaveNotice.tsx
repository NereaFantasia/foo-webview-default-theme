import { Button } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import type { ConfigPersistence } from '../host/configPref.ts';
import {
  prefSaveStatesAtom,
  prefStorageAvailableAtom,
  prefStorageKey,
} from '../kit/prefStorage.ts';
import { useService } from '../kit/useService.ts';
import { translateAtom } from '../i18n/locale.ts';
import styles from './SettingsSaveNotice.module.css';

interface SettingsSaveNoticeProps {
  readonly persistence: Pick<ConfigPersistence, 'state' | 'retry'>;
  readonly keys: readonly string[];
  readonly unavailable?: boolean;
}

/** 操作反馈与当前值分开；重试成功后保留可获焦的按钮，避免键盘焦点落到页面外。 */
export function SettingsSaveNotice({
  persistence,
  keys,
  unavailable = false,
}: SettingsSaveNoticeProps) {
  const t = useAtomValueRawSync(translateAtom);
  const states = useAtomValueRawSync(persistence.state);
  const failed = keys.filter((key) => states.get(key)?.status === 'failed');
  const pending = keys.some((key) => states.get(key)?.status === 'pending');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function retry() {
    if (running.current || unavailable) return;
    running.current = true;
    setAttempted(true);
    setBusy(true);
    try {
      await Promise.all(failed.map((key) => persistence.retry(key)));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const visible = failed.length > 0 || attempted;
  const message = !visible
    ? ''
    : busy || pending
      ? t('saving.pending')
      : failed.length > 0
        ? t(unavailable ? 'saving.unavailable' : 'saving.failed')
        : t('saving.saved');
  return (
    <div className={styles.root} data-save-feedback>
      <span className={failed.length > 0 ? styles.error : undefined} role="status">
        {message}
      </span>
      {visible && !unavailable && (
        <Button
          size="small"
          appearance="subtle"
          disabledFocusable={busy || pending || failed.length === 0}
          onClick={() => void retry()}
        >
          {t('saving.retry')}
        </Button>
      )}
    </div>
  );
}

/** 浏览器偏好的保存状态由页面统一订阅，控件只声明自己写入的键。 */
export function LocalSaveNotice({ keys }: { readonly keys: readonly string[] }) {
  const storage = useService(prefStorageKey);
  const available = useAtomValueRawSync(prefStorageAvailableAtom);
  return (
    <SettingsSaveNotice
      keys={keys}
      unavailable={!available}
      persistence={{ state: prefSaveStatesAtom, retry: storage.retry }}
    />
  );
}
