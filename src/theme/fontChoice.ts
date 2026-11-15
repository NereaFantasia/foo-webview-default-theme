import { defineLocalPref, storedRecord, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { DEFAULT_FONT_CHOICE, fontNameOf, type FontChoice } from './fontStack.ts';

/**
 * 界面字体存在浏览器偏好里，不进宿主 config：首帧就要用，等宿主答复会先闪一下默认字体
 */
export const FONT_CHOICE_KEY = 'default-theme.font.v1';

const pref = defineLocalPref<FontChoice>({
  key: FONT_CHOICE_KEY,
  fallback: DEFAULT_FONT_CHOICE,
  parse(raw) {
    const saved = storedRecord(raw);
    return { latin: fontNameOf(saved.latin), cjk: fontNameOf(saved.cjk) };
  },
  format: (value) => JSON.stringify(value),
});

export const fontChoiceAtom = pref.atom;

export function loadFontChoice(store: Store, storage?: PrefStorage | null): void {
  pref.load(store, storage);
}

/** 值先过 `fontNameOf`：不合格的当作回到默认 */
export function chooseFont(
  store: Store,
  patch: Partial<FontChoice>,
  storage?: PrefStorage | null,
): void {
  const current = store.get(pref.atom);
  const next = {
    latin: patch.latin === undefined ? current.latin : fontNameOf(patch.latin),
    cjk: patch.cjk === undefined ? current.cjk : fontNameOf(patch.cjk),
  };
  if (next.latin === current.latin && next.cjk === current.cjk) return;
  pref.set(store, next, storage);
}
