import type { fb } from 'foo-webview-sdk/bridge';
import type { DataWriter, DataWriteResult } from '../kit/dataWrite.ts';
import { hostCommand } from './hostCall.ts';

type ConfigValue = Parameters<typeof fb.config.set>[1];

export interface ConfigWriteFace {
  readonly config: Pick<typeof fb.config, 'set' | 'remove'>;
}

export interface ConfigWriter {
  set(key: string, value: ConfigValue, signal?: AbortSignal): Promise<DataWriteResult<number>>;
  remove(key: string, signal?: AbortSignal): Promise<DataWriteResult<number>>;
}

/** 创建带排他写锁与代数记录的宿主配置写入助手。仅在宿主持久化成功后更新代数；若缺少写入互斥器则明确拒绝，严禁无保护并发写入 */
export function createConfigWriter(
  host: ConfigWriteFace,
  writer: Pick<DataWriter, 'run'> | undefined,
): ConfigWriter {
  function write(
    key: string,
    persist: () => Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<DataWriteResult<number>> {
    if (!key) return Promise.resolve({ success: false, reason: 'invalid-key' });
    if (!writer) return Promise.resolve({ success: false, reason: 'unavailable' });
    return writer.run((scope) => scope.write(`config:${key}`, persist), signal);
  }

  return {
    async set(key, value, signal) {
      // 快照防并发篡改：在等待获锁期间对象可能被外部异步修改，深拷贝保证持久化快照的一致性
      let snapshot: ConfigValue;
      try {
        snapshot = structuredClone(value);
      } catch {
        return { success: false, reason: 'write-failed' };
      }
      return write(key, () => hostCommand(() => host.config.set(key, snapshot)), signal);
    },
    remove(key, signal) {
      return write(key, () => hostCommand(() => host.config.remove(key)), signal);
    },
  };
}
