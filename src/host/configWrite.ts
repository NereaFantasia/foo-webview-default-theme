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

/** 宿主确认写入或清除后才记代数；缺少写入助手时明确失败，不绕过锁直接写。 */
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
      // 等锁期间调用方可能继续修改对象，宿主收到的应是发起这次写入时的值。
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
