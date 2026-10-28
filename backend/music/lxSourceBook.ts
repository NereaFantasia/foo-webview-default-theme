import type { MusicPlatform } from '../../src/server/musicObjects.ts';

/** 触发临时跳过的连续失败次数阈值 */
const FAILURES_TO_SKIP = 2;
const SKIP_MS = 10 * 60_000;

interface Entry {
  readonly platform: MusicPlatform;
  readonly name: string;
  failures: number;
  /** 熔断截止时间戳，Unix 毫秒 */
  until: number;
}

/**
 * 记录音源在各平台上的连续失败状态与临时熔断窗口
 * 解析地址时排除熔断中的音源，避免重复等待超时；解析成功或音源配置变更时重置
 */
export function startLxSourceBook(now: () => number = Date.now) {
  const records = new Map<string, Entry>();
  const key = (platform: MusicPlatform, name: string) =>
    JSON.stringify([platform, name.trim().toLowerCase()]);
  return {
    failed(platform: MusicPlatform, name: string): void {
      const id = key(platform, name);
      const record = records.get(id) ?? { platform, name, failures: 0, until: 0 };
      record.failures += 1;
      if (record.failures >= FAILURES_TO_SKIP) record.until = now() + SKIP_MS;
      records.set(id, record);
    },
    succeeded(platform: MusicPlatform, name: string): void {
      records.delete(key(platform, name));
    },
    /** 获取指定平台上处于熔断窗口内的音源名称列表 */
    skipped(platform: MusicPlatform): string[] {
      const at = now();
      return [...records.values()]
        .filter((record) => record.platform === platform && record.until > at)
        .map((record) => record.name);
    },
    clear(): void {
      records.clear();
    },
  };
}

export type LxSourceBook = ReturnType<typeof startLxSourceBook>;
