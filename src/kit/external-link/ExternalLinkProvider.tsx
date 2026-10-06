import {
  Checkbox,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import type { ExternalLinkGate } from './externalLinkGate.ts';
import styles from './ExternalLinkProvider.module.css';

const CONTEXT = createContext<ExternalLinkGate | null>(null);
export function useExternalLinks(): ExternalLinkGate {
  const service = useContext(CONTEXT);
  if (!service) throw new Error('外部链接服务尚未挂载');
  return service;
}

function ExternalLinkDialog({ service }: { readonly service: ExternalLinkGate }) {
  const prompt = useAtomValueRawSync(service.prompt);
  const t = useAtomValueRawSync(translateAtom);
  const [remember, setRemember] = useState(false);
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(_, data) => {
        if (!data.open) service.cancel();
      }}
    >
      <DialogSurface
        onPointerDown={(event) => event.stopPropagation()}
        backdrop={{ onPointerDown: (event) => event.stopPropagation() }}
      >
        <DialogBody>
          <DialogTitle>{t('links.openTitle')}</DialogTitle>
          <DialogContent>
            <p>{t('links.openDescription')}</p>
            <p className={styles.url}>{prompt?.url}</p>
            <Checkbox
              label={t('links.remember')}
              checked={remember}
              disabled={prompt?.busy}
              onChange={(_, data) => setRemember(data.checked === true)}
            />
            {prompt?.failed && <p role="alert">{t('links.failed')}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={prompt?.busy} onClick={service.cancel}>
              {t('links.cancel')}
            </Button>
            <Button
              appearance="primary"
              disabled={prompt?.busy}
              onClick={() => service.confirm(remember)}
            >
              {t('links.open')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ExternalLinkProvider({
  service,
  children,
}: {
  readonly service: ExternalLinkGate;
  readonly children: ReactNode;
}) {
  const prompt = useAtomValueRawSync(service.prompt);
  return (
    <CONTEXT value={service}>
      {children}
      <ExternalLinkDialog key={prompt?.url ?? ''} service={service} />
    </CONTEXT>
  );
}
