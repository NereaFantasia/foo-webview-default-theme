import { atom } from 'jotai/vanilla';
import { windowActivityAtom } from '../host/windowActivity.ts';
import { miniWindowAtom } from '../host/miniWindow.ts';
import type { Store } from '../kit/store.ts';
import { immersiveSettledAtom } from '../immersive/scene/entryStage.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { startFlowingField } from '../theme/background/flowingField.ts';

// 沉浸视图盖住窗口后才挂起：挂起要同步读回一帧并销毁上下文，不与它的进场挤在同一刻
const ACTIVITY = atom((get) => {
  const window = get(windowActivityAtom);
  return {
    visible:
      window.documentVisible &&
      window.minimized !== true &&
      !get(miniWindowAtom).active &&
      !(get(historyAtom).place.id === 'nowPlaying' && get(immersiveSettledAtom) !== null),
    focused: window.focused,
  };
});

export function startFlowingBackground(store: Store) {
  return startFlowingField({ store, activity: ACTIVITY });
}
