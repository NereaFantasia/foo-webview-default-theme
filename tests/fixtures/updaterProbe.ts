import { createStore } from 'jotai/vanilla';
import type { PublishedKey } from '../../src/update/contract.ts';
import {
  confirmedStartupAtom,
  type ConfirmedStartup,
} from '../../src/update/loaderConfirmation.ts';
import { startUpdater, type UpdateStatus } from '../../src/update/updater.ts';

/**
 * 在浏览器里经 Vite 加载真实的更新器，用测试公钥手动检查一轮：验签、解压与哈希都走 Chromium 自己的
 * WebCrypto、DecompressionStream，宿主调用经页面里的 SDK 交给 Node 端的替身。
 */
export async function runUpdaterProbe(
  keys: readonly PublishedKey[],
  startup: ConfirmedStartup,
  action: 'check' | 'install' = 'install',
): Promise<UpdateStatus> {
  const store = createStore();
  const updater = startUpdater(store, { keys, pause: async () => {} });
  try {
    store.set(confirmedStartupAtom, startup);
    await updater[action]();
    return store.get(updater.status);
  } finally {
    updater.dispose();
  }
}
