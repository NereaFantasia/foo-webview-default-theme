import {
  Button,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
} from '@fluentui/react-components';
import { Dialog } from '../../../motion/Surfaces.tsx';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useState } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { MessageKey } from '../../../i18n/en.ts';
import { useArtists } from '../artistsContext.ts';
import { artistWritePlan, type ArtistWritePlan } from '../artistWrites.ts';

export function ArtistRenameDialog({
  names,
  target,
  onClose,
}: {
  readonly names: readonly string[];
  readonly target: string;
  readonly onClose: () => void;
}) {
  const services = useArtists();
  const t = useAtomValueRawSync(translateAtom);
  const basis = useAtomValueRawSync(services.catalog.state).basis;
  const writing = useAtomValueRawSync(services.writes.state);
  const [name, setName] = useState(target);
  const [plan, setPlan] = useState<ArtistWritePlan | null>(null);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  useEffect(() => {
    let active = true;
    void services.actions.tracksOf(names).then((tracks) => {
      if (!active) return;
      if (!tracks) setFailure('context.tracksFailed');
      else setPlan(artistWritePlan(tracks, names, basis));
    });
    return () => {
      active = false;
    };
  }, [services, names, basis]);
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !writing.busy) onClose();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {t(names.length > 1 ? 'artists.mergeTitle' : 'artists.renameTitle')}
          </DialogTitle>
          <DialogContent>
            <Field label={t('artists.targetName')}>
              <Input
                value={name}
                disabled={writing.busy}
                onChange={(_, data) => setName(data.value)}
              />
            </Field>
            {!plan && !failure && <Spinner size="small" label={t('album.loading')} />}
            {plan && (
              <p>
                {t('artists.writeSummary', {
                  total: plan.changes.length + plan.skipped.length,
                  changed: plan.changes.length,
                  skipped: plan.skipped.length,
                })}
              </p>
            )}
            {!!plan?.skipped.length && (
              <Button
                disabled={writing.busy}
                onClick={() => {
                  void services.writes
                    .properties(plan.skipped)
                    .then((ok) => setFailure(ok ? null : 'artists.propertiesFailed'));
                }}
              >
                {t('artists.skippedProperties')}
              </Button>
            )}
            {writing.busy && <Spinner size="small" label={t('artists.writing')} />}
            {failure && <p role="alert">{t(failure)}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={writing.busy} onClick={onClose}>
              {t('artists.cancel')}
            </Button>
            <Button
              appearance="primary"
              disabled={writing.busy || !name.trim() || !plan?.changes.length}
              onClick={() => {
                if (plan) {
                  setFailure(null);
                  void services.writes.rename(plan, name).then((ok) => {
                    services.retry();
                    if (ok) onClose();
                    else setFailure('artists.writeFailed');
                  });
                }
              }}
            >
              {t(names.length > 1 ? 'artists.merge' : 'artists.rename')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
