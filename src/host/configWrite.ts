import type { fb } from 'foo-webview-sdk/bridge';
import type { DataWriter, DataWriteResult, DataWriteScope } from '../kit/dataWrite.ts';
import { hostCommand } from './hostCall.ts';

type ConfigValue = Parameters<typeof fb.config.set>[1];

export interface ConfigWriteFace {
  readonly config: Pick<typeof fb.config, 'set' | 'remove'>;
}

export interface ConfigWriter {
  set(key: string, value: ConfigValue, signal?: AbortSignal): Promise<DataWriteResult<number>>;
  remove(key: string, signal?: AbortSignal): Promise<DataWriteResult<number>>;
}

/** 使用调用方已持有的写锁保存配置，并在宿主确认后记录代数 */
export function setConfigInScope(
  scope: Pick<DataWriteScope, 'write'>,
  config: Pick<ConfigWriteFace['config'], 'set'>,
  key: string,
  value: ConfigValue,
): Promise<number> {
  return scope.write(`config:${key}`, () => hostCommand(() => config.set(key, value)));
}

/**
 * 创建宿主配置的写入助手。每次写入都在排他写锁内执行，宿主保存成功后才记录代数
 *
 * 没有 `writer` 时，写入一律以 `unavailable` 失败，不在锁外执行
 */
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
      // 先复制 value，使保存的内容是调用 set 时的值。等待写锁期间，调用方可能修改原对象
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
