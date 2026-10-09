import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import {
  ArrowClockwise16Regular,
  ArrowSync16Regular,
  FolderOpen16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useState } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import type { Translate } from '../i18n/translate.ts';
import { useService } from '../kit/useService.ts';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { pluginUpdaterKey, type PluginUpdateStatus } from '../update/pluginUpdater.ts';

function description(status: PluginUpdateStatus, t: Translate): string | undefined {
  switch (status.phase) {
    case 'off':
      return undefined;
    case 'current':
      return t('update.pluginCurrent');
    case 'checking':
      return t('update.checking');
    case 'available':
      return t('update.available', { version: status.version });
    case 'downloading':
      return t('update.downloading', { version: status.version });
    case 'preparing':
      return t('update.pluginPreparing', { version: status.version });
    case 'restarting':
      return t('update.pluginRestarting');
    case 'failed':
      return t('update.pluginFailed');
    case 'blocked': {
      const keys = {
        backend: 'update.pluginNeedsBackend',
        pending: 'update.pluginNeedsTheme',
        compatibility: 'update.pluginIncompatible',
      } as const;
      return t(keys[status.reason]);
    }
    case 'transaction': {
      const keys: Partial<Record<typeof status.transaction.phase, MessageKey>> = {
        committed: 'update.pluginCompleted',
        rolledBack: 'update.pluginRolledBack',
        cancelled: 'update.pluginCancelled',
        needsRepair: 'update.pluginNeedsRepair',
        prepared: 'update.pluginPrepared',
      };
      return t(keys[status.transaction.phase] ?? 'update.pluginUnfinished', {
        version: status.transaction.version,
      });
    }
  }
}

export function PluginUpdateRow() {
  const t = useAtomValueRawSync(translateAtom);
  const service = useService(pluginUpdaterKey);
  const status = useAtomValueRawSync(service.status);
  const controls = useViewControlStyles();
  const buttonId = useId();
  const [confirmation, setConfirmation] = useState<{ version: string; sha256: string } | null>(
    null,
  );
  const [openFailed, setOpenFailed] = useState(false);
  const available = status.phase === 'available';
  const busy = ['checking', 'downloading', 'preparing', 'restarting'].includes(status.phase);
  const transaction = status.phase === 'transaction' ? status.transaction : null;
  const recovery =
    transaction !== null && !['committed', 'cancelled', 'prepared'].includes(transaction.phase);
  const error =
    status.phase === 'failed' ||
    transaction?.phase === 'needsRepair' ||
    transaction?.phase === 'rolledBack';
  const detail = status.phase === 'failed' ? status.detail : transaction?.error;
  if (status.phase === 'off') return null;
  return (
    <>
      <SettingsRow
        field
        title={t('update.pluginTitle')}
        description={openFailed ? t('update.pluginOpenFailed') : description(status, t)}
        error={error || openFailed}
        feedback={
          detail ? (
            <details>
              <summary>{t('update.backendDetails')}</summary>
              <div>{detail}</div>
            </details>
          ) : undefined
        }
      >
        {({ labelId, descriptionId }) =>
          recovery ? (
            <Button
              id={buttonId}
              className={controls.field}
              icon={<FolderOpen16Regular />}
              aria-labelledby={`${buttonId} ${labelId}`}
              aria-describedby={descriptionId}
              onClick={() => void service.openRecovery().then((ok) => setOpenFailed(!ok))}
            >
              {t('update.pluginRecovery')}
            </Button>
          ) : (
            <Button
              id={buttonId}
              className={available ? undefined : controls.field}
              appearance={available ? 'primary' : 'secondary'}
              icon={available ? <ArrowClockwise16Regular /> : <ArrowSync16Regular />}
              disabledFocusable={busy}
              aria-labelledby={`${buttonId} ${labelId}`}
              aria-describedby={descriptionId}
              onClick={() =>
                available
                  ? setConfirmation({ version: status.version, sha256: status.sha256 })
                  : void service.check()
              }
            >
              {t(available ? 'update.pluginInstall' : 'update.checkNow')}
            </Button>
          )
        }
      </SettingsRow>
      <Dialog
        open={confirmation !== null}
        modalType="alert"
        onOpenChange={(_, data) => {
          if (!data.open) setConfirmation(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {t('update.pluginConfirmTitle', { version: confirmation?.version ?? '' })}
            </DialogTitle>
            <DialogContent>
              <p>{t('update.pluginConfirmScope')}</p>
              <p>{t('update.pluginConfirmRisk')}</p>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                icon={<ArrowClockwise16Regular />}
                onClick={() => {
                  const selected = confirmation;
                  setConfirmation(null);
                  if (selected) void service.install(selected.sha256);
                }}
              >
                {t('update.pluginInstall')}
              </Button>
              <Button autoFocus onClick={() => setConfirmation(null)}>
                {t('common.cancel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
