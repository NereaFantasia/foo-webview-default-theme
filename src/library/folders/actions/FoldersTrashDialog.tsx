import {
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  ProgressBar,
} from '@fluentui/react-components';
import { Dialog } from '../../../motion/Surfaces.tsx';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../../../i18n/locale.ts';
import { BACK_BUTTON, FORWARD_BUTTON, BACK_KEYS, FORWARD_KEYS } from '../../../nav/navCommands.ts';
import { useCommand } from '../../../nav/useCommand.ts';
import { foldersTrashAtom } from './foldersTrash.ts';
import styles from './FoldersTrashDialog.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

export function FoldersTrashDialog() {
  const t = useAtomValueRawSync(translateAtom);
  const folders = useService(foldersKey);
  const state = useAtomValueRawSync(foldersTrashAtom);
  const open = state.phase !== 'closed';
  const running = state.phase === 'running';
  const completed = state.items.filter((item) => item.status !== 'pending').length;
  useCommand({
    id: 'folders.trash-modal',
    layer: 'overlay',
    keys: [...BACK_KEYS, ...FORWARD_KEYS],
    buttons: [BACK_BUTTON, FORWARD_BUTTON],
    enabled: () => open,
    run: () => {},
  });
  return (
    <Dialog
      open={open}
      modalType="alert"
      onOpenChange={(_, data) => {
        if (!data.open && !running) folders.trash.dismiss();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('folders.trash')}</DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <p>
                {t('folders.trashSummary', { tracks: state.tracks, files: state.items.length })}
              </p>
              <p>{t('folders.trashWholeFile')}</p>
              {state.unsupported > 0 && <p role="alert">{t('folders.trashUnsupported')}</p>}
              {running && (
                <ProgressBar
                  value={completed}
                  max={Math.max(1, state.items.length)}
                  aria-label={t('folders.trashProgress')}
                />
              )}
              <ul className={styles.files} aria-label={t('folders.trashFiles')}>
                {state.items.map((item) => (
                  <li key={item.path}>
                    <span className={styles.path}>{item.path}</span>
                    {state.phase !== 'confirm' && <span>{t(`folders.trash.${item.status}`)}</span>}
                  </li>
                ))}
              </ul>
              <p role="status">
                {t(state.stopping && running ? 'folders.trashStopping' : 'folders.trashRecovery')}
              </p>
            </div>
          </DialogContent>
          <DialogActions>
            {state.phase === 'confirm' && (
              <Button
                appearance="primary"
                disabled={state.unsupported > 0 || !state.items.length}
                onClick={() => void folders.trash.confirm()}
              >
                {t('folders.trashConfirm')}
              </Button>
            )}
            <Button
              autoFocus
              disabled={running && state.stopping}
              onClick={running ? folders.trash.cancel : folders.trash.dismiss}
            >
              {t(
                running
                  ? 'folders.trashStop'
                  : state.phase === 'confirm'
                    ? 'common.cancel'
                    : 'folders.dismiss',
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
