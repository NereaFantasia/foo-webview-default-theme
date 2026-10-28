import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { useService } from '../kit/useService.ts';
import { musicClientKey } from '../playback/musicClient.ts';
import type { MusicLxHealth, MusicLxSource } from '../server/musicLxSources.ts';
import type { MusicPlatform } from '../server/musicObjects.ts';
import { checkable } from './lxHealthText.ts';

/** 连通性检测并发上限；检测涉及真实探测音频流地址，限制并发以规避平台限流 */
const CONCURRENCY = 2;

interface Target {
  readonly id: string;
  readonly platform: MusicPlatform;
}

const keyOf = (id: string, platform: MusicPlatform) => JSON.stringify([id, platform]);

/**
 * 音源连通性检测调度 hook
 *
 * 采用固定并发队列调度目标平台检测，组件卸载时中止未决请求；
 * 通信异常时保留先前健康度状态并触发失败提示
 */
export function useLxChecks(
  sources: readonly MusicLxSource[] | null,
  merge: (id: string, platform: MusicPlatform, health: MusicLxHealth) => void,
  fail: (message: MessageKey) => void,
) {
  const client = useService(musicClientKey);
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  async function run(targets: readonly Target[]): Promise<void> {
    const signal = lifetime.current?.signal;
    if (!signal || !targets.length) return;
    setChecking(
      (current) => new Set([...current, ...targets.map((item) => keyOf(item.id, item.platform))]),
    );
    const queue = [...targets];
    const worker = async () => {
      for (let target = queue.shift(); target; target = queue.shift()) {
        try {
          merge(
            target.id,
            target.platform,
            await client.checkLxSource(target.id, target.platform, { signal }),
          );
        } catch {
          if (!signal.aborted) fail('online.lxCheckFailed');
        } finally {
          const done = keyOf(target.id, target.platform);
          if (!signal.aborted)
            setChecking((current) => new Set([...current].filter((item) => item !== done)));
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  const targetsOf = (list: readonly MusicLxSource[]) =>
    list
      .filter(checkable)
      .flatMap((source) => source.platforms.map((platform) => ({ id: source.id, platform })));

  return {
    checkingAll,
    /** 指定音源处于检测中的平台集合 */
    checkingOf: (source: MusicLxSource): ReadonlySet<MusicPlatform> =>
      new Set(source.platforms.filter((platform) => checking.has(keyOf(source.id, platform)))),
    hasTargets: sources !== null && targetsOf(sources).length > 0,
    checkSource: (source: MusicLxSource) => void run(targetsOf([source])),
    async checkAll() {
      if (!sources) return;
      setCheckingAll(true);
      await run(targetsOf(sources));
      if (!lifetime.current?.signal.aborted) setCheckingAll(false);
    },
  };
}
