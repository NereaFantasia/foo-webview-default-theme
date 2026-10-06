import { atom } from 'jotai/vanilla';
import { defineLocalPref, ON_OFF, storedRecord, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { baseAccentRampAtom, baseAccentToneAtom } from './baseAccent.ts';
import { rampFrom } from './brandRamp.ts';
import { isCoverProfile, type CoverProfile, type CoverSeed } from './coverPalette.ts';

export const COVER_ACCENT_STORAGE_KEY = 'default-theme.cover-accent.v1';
export const COVER_PROFILE_STORAGE_KEY = 'default-theme.cover-profile.v1';
/** 缺省开：没有存档、存档认不出或存储读不了都按开，只有明确的 `off` 才关。 */
const enabledPref = defineLocalPref<boolean>({
  key: COVER_ACCENT_STORAGE_KEY,
  fallback: true,
  ...ON_OFF,
});
/** 读过或选过开关之后为真，启动服务时不再拿存档盖掉。 */
const enabledSettledAtom = atom(false);
/** 上次播放的封面配色，只用于等宿主应答期间，不作为当前曲目已确认的结果。 */
const profileCache = defineLocalPref<CoverProfile | null>({
  key: COVER_PROFILE_STORAGE_KEY,
  fallback: null,
  parse(raw) {
    const saved = storedRecord(raw);
    return saved.version === 1 && isCoverProfile(saved.profile) ? saved.profile : undefined;
  },
  format: (profile) => JSON.stringify({ version: 1, profile }),
});
const initializedAtom = atom(false);
const seedAtom = atom<CoverSeed | null>(null);
const profileAtom = atom<CoverProfile | null>(null);

export const coverProfileAtom = atom((get) => get(profileAtom));
export const coverAccentEnabledAtom = enabledPref.atom;
export const coverRampAtom = atom((get) => {
  const seed = get(seedAtom);
  return seed ? rampFrom(seed) : get(baseAccentRampAtom);
});
export const accentRampAtom = atom((get) =>
  get(coverAccentEnabledAtom) ? get(coverRampAtom) : get(baseAccentRampAtom),
);
export const coverAccentToneAtom = atom(
  (get) => get(profileAtom)?.accent ?? get(baseAccentToneAtom),
);
export const globalAccentToneAtom = atom((get) =>
  get(coverAccentEnabledAtom) ? get(coverAccentToneAtom) : get(baseAccentToneAtom),
);

export function loadCoverAccentEnabled(store: Store, storage?: PrefStorage | null): void {
  store.set(enabledSettledAtom, true);
  enabledPref.load(store, storage);
}

/** 与此刻相同不写存档；存不下这一次照常生效。 */
export function chooseCoverAccentEnabled(
  store: Store,
  next: boolean,
  storage?: PrefStorage | null,
): void {
  store.set(enabledSettledAtom, true);
  enabledPref.set(store, next, storage);
}

export function publishCoverProfile(store: Store, profile: CoverProfile | null): void {
  store.set(profileAtom, profile);
  const next = profile?.accent ?? null;
  const current = store.get(seedAtom);
  if (next?.hue !== current?.hue || next?.chroma !== current?.chroma) store.set(seedAtom, next);
}

/** 在 React 首帧之前调。 */
export function initializeAccent(store: Store, storage?: PrefStorage | null): void {
  if (store.get(initializedAtom)) return;
  store.set(initializedAtom, true);
  if (!store.get(enabledSettledAtom)) loadCoverAccentEnabled(store, storage);
  const cached = profileCache.read(storage);
  if (cached) publishCoverProfile(store, cached);
}

/** 写不进只影响下次启动，颜色仍在内存中生效。 */
export function saveCoverProfile(profile: CoverProfile | null, storage?: PrefStorage | null): void {
  profileCache.write(profile, storage);
}
