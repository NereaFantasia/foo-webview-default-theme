import { atom } from 'jotai/vanilla';
import type { ObjectOpener } from '../../src/nav/objectOpener.ts';

/** 对象打开服务的替身：一律打得开、不在目标页里，`open` 不导航 */
export function stubObjectOpener(): ObjectOpener {
  return {
    availability: () => 'ready',
    revision: atom(0),
    isHere: () => false,
    open: () => Promise.resolve('done'),
    pending: atom(null),
    notice: atom(null),
    dismissNotice() {},
    dispose() {},
  };
}
