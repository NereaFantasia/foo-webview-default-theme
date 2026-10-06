import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { defineConfigPref, startConfigPrefs, type ConfigPrefFace } from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { compareVersions, isStableVersion } from './contract.ts';
import { confirmedStartupAtom } from './loaderConfirmation.ts';
import type { UpdaterService } from './updater.ts';

const SEEN = defineConfigPref<string | null>('defaultTheme.changelog.seen', null, (value) =>
  isStableVersion(value) ? value : undefined,
);

export interface ChangelogView {
  readonly opened: Atom<boolean>;
  readonly selected: Atom<string | null>;
  show(): void;
  close(): void;
  select(version: string): void;
  dispose(): void;
}

export function startChangelogView(
  store: Store,
  updater: Pick<UpdaterService, 'changelog' | 'catalog' | 'check'>,
  writer: Pick<ConfigWriter, 'set'>,
  host: ConfigPrefFace = fb,
): ChangelogView {
  const prefs = startConfigPrefs(store, [SEEN], host, writer);
  const opened = atom(false);
  const selected = atom<string | null>(null);
  let disposed = false;
  let ready = false;
  let initialized = false;
  let picked = false;
  let manual = false;

  function choose(): void {
    if (!store.get(opened)) return;
    const entries = store.get(updater.changelog)?.entries ?? [];
    const selectedVersion = entries.find((entry) => entry.version === store.get(selected))?.version;
    if (picked && selectedVersion) return;
    picked = false;
    const target = manual ? store.get(updater.catalog)?.target : null;
    const current = store.get(confirmedStartupAtom)?.session.version.v;
    store.set(
      selected,
      entries.find((entry) => entry.version === target)?.version ??
        selectedVersion ??
        entries.find((entry) => entry.version === current)?.version ??
        entries[0]?.version ??
        null,
    );
  }

  function sync(): void {
    if (disposed) return;
    const current = store.get(confirmedStartupAtom)?.session.version.v;
    if (ready && current && !initialized) {
      const seen = store.get(SEEN.atom);
      const upgraded = seen !== null && (compareVersions(current, seen) ?? 0) > 0;
      const entry = store.get(updater.changelog)?.entries.find((item) => item.version === current);
      // 升级时等本版日志可读后再记已读；首次安装只建立基线，回退不降低已读版本。
      if (!upgraded || entry) {
        initialized = true;
        if (upgraded) {
          manual = false;
          picked = false;
          store.set(selected, current);
          store.set(opened, true);
        }
        if (seen === null || upgraded) void prefs.set(SEEN, current);
      }
    }
    choose();
  }

  const offs = [
    store.sub(confirmedStartupAtom, sync),
    store.sub(updater.changelog, sync),
    store.sub(updater.catalog, sync),
  ];
  void prefs.ready.then(() => {
    ready = true;
    sync();
  });
  return {
    opened: atom((get) => get(opened)),
    selected: atom((get) => get(selected)),
    show() {
      if (disposed) return;
      manual = true;
      picked = false;
      store.set(selected, null);
      store.set(opened, true);
      choose();
      void updater.check();
    },
    close() {
      if (!disposed) store.set(opened, false);
    },
    select(version) {
      if (
        disposed ||
        !store.get(updater.changelog)?.entries.some((entry) => entry.version === version)
      )
        return;
      picked = true;
      store.set(selected, version);
    },
    dispose() {
      disposed = true;
      for (const off of offs) off();
      prefs.dispose();
    },
  };
}

export const changelogViewKey = serviceKey<ChangelogView>('changelogView');
