import { log } from '../diagnostics/eventLog.ts';
import type { Store } from '../kit/store.ts';
import type { BackendBootstrap } from '../update/backendBootstrap.ts';
import type { UpdaterService } from '../update/updater.ts';

/**
 * 本地后端与主题更新进入失败状态时记一条；只记状态的迁移，订阅时的初值不记。同一失败重复出现时由
 * 日志折叠；返回退订函数
 */
export function startRuntimeLogIntegration(
  store: Store,
  deps: {
    readonly backend: Pick<BackendBootstrap, 'status'>;
    readonly updater: Pick<UpdaterService, 'status'>;
  },
): () => void {
  const offs = [
    store.sub(deps.backend.status, () => {
      const status = store.get(deps.backend.status);
      if (status.phase === 'failed')
        log.error('backend', 'bootstrap.failed', { reason: status.reason, detail: status.detail });
    }),
    store.sub(deps.updater.status, () => {
      const status = store.get(deps.updater.status);
      if (status.phase === 'idle' && status.failure !== null)
        log.warn('update', 'check.failed', { failure: status.failure, gaveUp: status.gaveUp });
      else if (status.phase === 'manual') log.warn('update', 'manual', { reason: status.reason });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
