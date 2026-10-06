import { argbFromHex, Hct } from '@material/material-color-utilities';
import { fb } from 'foo-webview-sdk/bridge';
import { atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost } from '../host/waitForHost.ts';
import { defineLocalPref, storedRecord, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { tealBrand } from './brand.ts';
import { rampFrom } from './brandRamp.ts';

export const BASE_ACCENT_STORAGE_KEY = 'default-theme.base-accent.v1';
export const BASE_ACCENT_MODES = ['teal', 'windows', 'custom'] as const;
export type BaseAccentMode = (typeof BASE_ACCENT_MODES)[number];

/** 用哪种基础色，自定义的那一色，以及上次读到的 Windows 强调色（宿主应答之前先用它）。 */
interface BaseAccentPrefs {
  readonly mode: BaseAccentMode;
  readonly custom: string;
  readonly windows: string | null;
}
const DEFAULT_PREFS: BaseAccentPrefs = { mode: 'teal', custom: tealBrand[100], windows: null };

export function isAccentHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
function isMode(value: unknown): value is BaseAccentMode {
  return BASE_ACCENT_MODES.some((mode) => mode === value);
}

/** 用哪种认不出时整份按缺省，另两项也不读；颜色不是 `#rrggbb` 的那一项按缺省。 */
const accentPref = defineLocalPref<BaseAccentPrefs>({
  key: BASE_ACCENT_STORAGE_KEY,
  fallback: DEFAULT_PREFS,
  parse(raw) {
    const saved = storedRecord(raw);
    if (!isMode(saved.mode)) return undefined;
    return {
      mode: saved.mode,
      custom: isAccentHex(saved.custom) ? saved.custom.toLowerCase() : DEFAULT_PREFS.custom,
      windows: isAccentHex(saved.windows) ? saved.windows.toLowerCase() : null,
    };
  },
  format: (value) => JSON.stringify(value),
});
export const baseAccentModeAtom = atom((get) => get(accentPref.atom).mode);
export const customAccentAtom = atom((get) => get(accentPref.atom).custom);
const windowsAtom = atom((get) => get(accentPref.atom).windows);
const failedAtom = atom(false);
const refreshAtom = atom(0);
const initializedAtom = atom(false);

export const windowsAccentFailedAtom = atom((get) => get(failedAtom));
export const baseAccentSourceAtom = atom((get) => {
  const mode = get(baseAccentModeAtom);
  return mode === 'windows' && !get(windowsAtom) ? 'teal' : mode;
});
export const baseAccentColorAtom = atom((get) => {
  const mode = get(baseAccentModeAtom);
  return mode === 'custom'
    ? get(customAccentAtom)
    : mode === 'windows'
      ? (get(windowsAtom) ?? tealBrand[100])
      : tealBrand[100];
});
export const baseAccentRampAtom = atom((get) => {
  if (get(baseAccentSourceAtom) === 'teal') return tealBrand;
  const { hue, chroma } = Hct.fromInt(argbFromHex(get(baseAccentColorAtom)));
  return rampFrom({ hue, chroma });
});
export const baseAccentToneAtom = atom((get) => {
  const argb = argbFromHex(get(baseAccentColorAtom));
  const { hue, chroma, tone } = Hct.fromInt(argb);
  return { argb, hue, chroma, tone };
});

export function initializeBaseAccent(store: Store, storage?: PrefStorage | null): void {
  if (store.get(initializedAtom)) return;
  store.set(initializedAtom, true);
  accentPref.load(store, storage);
}
export function chooseBaseAccent(
  store: Store,
  mode: BaseAccentMode,
  storage?: PrefStorage | null,
): void {
  accentPref.set(store, { ...store.get(accentPref.atom), mode }, storage);
}
export function chooseCustomAccent(
  store: Store,
  color: string,
  storage?: PrefStorage | null,
): boolean {
  if (!isAccentHex(color)) return false;
  accentPref.set(store, { ...store.get(accentPref.atom), custom: color.toLowerCase() }, storage);
  return true;
}
export function refreshWindowsAccent(store: Store): void {
  store.set(refreshAtom, (value) => value + 1);
}

export interface BaseAccentOptions {
  host?: Pick<typeof fb, 'isAvailable' | 'ready' | 'system'>;
  storage?: PrefStorage | null;
  focus?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/** Windows 无强调色变化事件；在选择、手动刷新和窗口回到前台时重新读取。 */
export function startBaseAccent(store: Store, options: BaseAccentOptions = {}) {
  const host = options.host ?? fb;
  const storage = options.storage;
  const focus =
    options.focus === undefined ? (typeof window === 'undefined' ? null : window) : options.focus;
  initializeBaseAccent(store, storage);
  let disposed = false;
  let generation = 0;
  let waiting: ReturnType<typeof waitForHost> | undefined;
  async function refresh() {
    const mine = ++generation;
    if (store.get(baseAccentModeAtom) !== 'windows') return;
    waiting ??= waitForHost(host);
    const ready = host.isAvailable() || (await waiting.done);
    if (disposed || mine !== generation) return;
    waiting.cancel();
    const answer = ready ? await settle(() => host.system.getTheme()) : null;
    if (disposed || mine !== generation) return;
    if (!answer || answer.success === false) {
      store.set(failedAtom, true);
      return;
    }
    accentPref.set(store, { ...store.get(accentPref.atom), windows: answer.accentColor }, storage);
    store.set(failedAtom, false);
  }
  const update = () => {
    void refresh();
  };
  const offs = [store.sub(baseAccentModeAtom, update), store.sub(refreshAtom, update)];
  focus?.addEventListener('focus', update);
  update();
  return {
    dispose() {
      disposed = true;
      generation += 1;
      waiting?.cancel();
      offs.forEach((off) => off());
      focus?.removeEventListener('focus', update);
    },
  };
}
