import type { Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { PLAY_BUTTON_STYLES, type PlayButtonStyle } from './playButtonColors.ts';

export const PLAY_BUTTON_STYLE_KEY = 'default-theme.play-button-style.v1';
/** 缺省柔和；存储不可用时照样切换，只是下次启动回到柔和。 */
const stylePref = defineLocalPref<PlayButtonStyle>({
  key: PLAY_BUTTON_STYLE_KEY,
  fallback: 'soft',
  ...choiceCodec(PLAY_BUTTON_STYLES),
});
export const playButtonStyleAtom: Atom<PlayButtonStyle> = stylePref.atom;

export function loadPlayButtonStyle(store: Store, storage?: PrefStorage | null): void {
  stylePref.load(store, storage);
}

export function choosePlayButtonStyle(
  store: Store,
  style: PlayButtonStyle,
  storage?: PrefStorage | null,
): void {
  stylePref.set(store, style, storage);
}
