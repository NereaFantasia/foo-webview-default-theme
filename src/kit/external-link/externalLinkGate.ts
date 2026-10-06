import type { ConfigWriter } from '../../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import { defineConfigPref, startConfigPrefs, type ConfigPrefFace } from '../../host/configPref.ts';
import { hostCommand } from '../../host/hostCall.ts';

export const EXTERNAL_LINK_CONFIRM = defineConfigPref(
  'defaultTheme.links.confirmExternal',
  true,
  (value) => (typeof value === 'boolean' ? value : undefined),
);

export function externalHttpUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export interface ExternalLinkPrompt {
  readonly url: string;
  readonly busy: boolean;
  readonly failed: boolean;
}

export function startExternalLinkGate(
  store: ReturnType<typeof createStore>,
  host: ConfigPrefFace & Pick<typeof fb, 'shell'> = fb,
  writer?: Pick<ConfigWriter, 'set'>,
) {
  const prefs = startConfigPrefs(store, [EXTERNAL_LINK_CONFIRM], host, writer);
  const prompt = atom<ExternalLinkPrompt | null>(null);
  let disposed = false;
  let generation = 0;
  let loaded = false;
  let launching = false;
  void prefs.ready.then(() => {
    loaded = true;
  });
  async function launch(url: string, remember: boolean, showPrompt = true): Promise<void> {
    const mine = ++generation;
    launching = true;
    if (showPrompt) store.set(prompt, { url, busy: true, failed: false });
    const ok = await hostCommand(() => host.shell.openExternal(url));
    if (disposed || mine !== generation) return;
    launching = false;
    if (ok) {
      if (remember) prefs.set(EXTERNAL_LINK_CONFIRM, false);
      store.set(prompt, null);
    } else store.set(prompt, { url, busy: false, failed: true });
  }
  return {
    prompt: atom((get) => get(prompt)),
    ready: prefs.ready,
    persistence: prefs,
    open(value: string): void {
      const url = externalHttpUrl(value);
      if (disposed || !url || launching) return;
      generation += 1;
      if (!loaded || store.get(EXTERNAL_LINK_CONFIRM.atom))
        store.set(prompt, { url, busy: false, failed: false });
      else void launch(url, false, false);
    },
    confirm(remember: boolean): void {
      const pending = store.get(prompt);
      if (!disposed && pending && !pending.busy) void launch(pending.url, remember);
    },
    cancel(): void {
      if (disposed || store.get(prompt)?.busy) return;
      generation += 1;
      store.set(prompt, null);
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      prefs.dispose();
    },
  };
}
export type ExternalLinkGate = ReturnType<typeof startExternalLinkGate>;
