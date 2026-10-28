import type { MusicLxHealth, MusicLxSource } from '../../src/server/musicLxSources.ts';
import type { MusicPlatform } from '../../src/server/musicObjects.ts';
import type { startLxConnection } from './lxConnection.ts';
import { cleanMessage, isRecord } from './lxSource.ts';
import type { LxSourceBook } from './lxSourceBook.ts';
import { MusicError } from './musicError.ts';
import { openUpstream } from './upstreamOpen.ts';

/** 检测音源的路由动作 */
export const LX_HEALTH_ACTIONS = ['lx-source-check'] as const;

/** 目录里没有这个平台的曲目时，用它搜一首来检测 */
const SAMPLE_QUERY = '周杰伦';

type LxConnection = Pick<Awaited<ReturnType<typeof startLxConnection>>, 'ready' | 'origin'>;

export interface LxHealthDeps {
  readonly lx: LxConnection;
  readonly list: (signal: AbortSignal) => Promise<MusicLxSource[]>;
  /** 检测结果同时记进去：取到能打开的地址清零，打不开记一次失败 */
  readonly book: LxSourceBook;
  readonly now?: () => number;
}

function codeOf(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

/**
 * 检测一个音源在目标平台上的可用性：解析样本曲目直链并实际发起连接
 * 脚本加载成功不代表地址有效，lxserver 亦不校验地址，须建立连接确认
 * 检测结果仅保存在内存中，后端重启后清空
 */
export function startLxHealth(deps: LxHealthDeps) {
  const now = deps.now ?? Date.now;
  const results = new Map<string, Partial<Record<MusicPlatform, MusicLxHealth>>>();
  const record = (id: string, platform: MusicPlatform, outcome: MusicLxHealth) =>
    results.set(id, { ...results.get(id), [platform]: outcome });

  async function check(
    id: string,
    platform: MusicPlatform,
    signal: AbortSignal,
  ): Promise<MusicLxHealth> {
    const list = await deps.list(signal);
    const target = list.find((item) => item.id === id);
    if (!target?.enabled || !target.platforms.includes(platform))
      throw new MusicError('invalid-request');
    const { source, catalog } = deps.lx.ready();

    let sample = catalog.latest(platform);
    if (!sample) {
      try {
        const found = await source.search(
          { platform, kind: 'track', query: SAMPLE_QUERY, cursor: null },
          signal,
        );
        if (found.records.length) await catalog.remember(found.records, signal);
        sample = found.records[0] ?? null;
      } catch (error) {
        if (error instanceof MusicError && error.code === 'cancelled') throw error;
      }
    }
    // 没能检测不是音源的错，不写进结果簿
    if (!sample) {
      const unknown: MusicLxHealth = {
        status: 'unknown',
        reason: 'no-sample',
        message: null,
        ms: 0,
        at: now(),
      };
      record(id, platform, unknown);
      return unknown;
    }

    const started = now();
    const finish = (
      reason: MusicLxHealth['reason'],
      message: string | null = null,
    ): MusicLxHealth => {
      const outcome: MusicLxHealth = {
        status: reason ? 'failed' : 'ok',
        reason,
        message,
        ms: Math.max(0, now() - started),
        at: now(),
      };
      record(id, platform, outcome);
      if (reason) deps.book.failed(platform, target.name);
      else deps.book.succeeded(platform, target.name);
      return outcome;
    };

    // 把别的音源都排除，lxserver 就只会问这一个
    const others = list.filter((item) => item.id !== id).map((item) => item.name);
    let url: string;
    try {
      url = (
        await source.resolve(sample, sample.track.qualities[0] ?? '128k', signal, others, true)
      ).url;
    } catch (error) {
      if (signal.aborted) throw new MusicError('cancelled');
      if (!(error instanceof MusicError)) throw error;
      if (error.code === 'timeout') return finish('timeout');
      // lxserver 自己连不上时没有应答正文，那不是这个音源的问题
      if (error.code === 'upstream-unavailable' && error.detail !== undefined)
        return finish('script', cleanMessage(isRecord(error.detail) ? error.detail.error : null));
      if (error.code === 'unplayable') return finish('script');
      throw error;
    }

    try {
      const upstream = await openUpstream(url, 'bytes=0-1', signal, deps.lx.origin());
      upstream.destroy();
      const status = upstream.statusCode ?? 0;
      if (status === 200 || status === 206 || status === 416) return finish(null);
      return finish('unreachable', `HTTP ${status}`);
    } catch (error) {
      if (signal.aborted) throw new MusicError('cancelled');
      if (error instanceof MusicError && error.code === 'timeout') return finish('timeout');
      return finish('unreachable', error instanceof MusicError ? null : codeOf(error));
    }
  }

  return {
    check,
    /** 附加各平台最近一次检测结果，并剔除已失效音源的记录 */
    attach(sources: readonly MusicLxSource[]): MusicLxSource[] {
      const ids = new Set(sources.map((item) => item.id));
      for (const id of results.keys()) if (!ids.has(id)) results.delete(id);
      return sources.map((item) => {
        const health: Partial<Record<MusicPlatform, MusicLxHealth>> = {};
        for (const platform of item.platforms) {
          const outcome = results.get(item.id)?.[platform];
          if (outcome) health[platform] = outcome;
        }
        return { ...item, health };
      });
    },
  };
}
