import { atom } from 'jotai/vanilla';
import { windowActivityAtom } from '../host/windowActivity.ts';
import { miniWindowAtom } from '../host/miniWindow.ts';
import type { Store } from '../kit/store.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { startFlowingField } from '../theme/background/flowingField.ts';

const ACTIVITY = atom((get) => {
  const window = get(windowActivityAtom);
  return {
    visible:
      window.documentVisible &&
      window.minimized !== true &&
      !get(miniWindowAtom).active &&
      get(historyAtom).place.id !== 'nowPlaying',
    focused: window.focused,
  };
});

export function startFlowingBackground(store: Store) {
  return startFlowingField({ store, activity: ACTIVITY });
}
