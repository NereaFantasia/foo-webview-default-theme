import { useEffect, useState } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { useService } from '../kit/useService.ts';
import { MusicClientError, musicClientKey } from '../playback/musicClient.ts';
import type { MusicLxHealth, MusicLxSource } from '../server/musicLxSources.ts';
import type { MusicPlatform } from '../server/musicObjects.ts';

function failureOf(error: unknown, fallback: MessageKey): MessageKey {
  const code = error instanceof MusicClientError ? error.code : null;
  return code === 'source-rejected' ? 'online.lxRejected' : fallback;
}

/** 管理 lxserver 音源列表状态与变更操作的 hook；变更操作串行执行并由服务端返回最新列表 */
export function useLxSources(active: boolean) {
  const client = useService(musicClientKey);
  const [sources, setSources] = useState<readonly MusicLxSource[] | null>(null);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active) return;
    const lifetime = new AbortController();
    client.lxSources({ signal: lifetime.signal }).then(setSources, () => {
      if (!lifetime.signal.aborted) setFailure('online.lxListFailed');
    });
    return () => lifetime.abort();
  }, [active, client, round]);
  const change = (
    run: () => Promise<readonly MusicLxSource[]>,
    fallback: MessageKey = 'online.lxChangeFailed',
  ) => {
    setBusy(true);
    setFailure(null);
    void run()
      .then(setSources, (error: unknown) => {
        setFailure(failureOf(error, fallback));
        // 变更请求失败时重新拉取服务端列表，确保本地状态与服务端实际结果同步
        setRound((value) => value + 1);
      })
      .finally(() => setBusy(false));
  };
  /** 合并单个音源平台的连通性检测结果至本地列表 */
  const merge = (id: string, platform: MusicPlatform, health: MusicLxHealth) =>
    setSources(
      (list) =>
        list?.map((item) =>
          item.id === id ? { ...item, health: { ...item.health, [platform]: health } } : item,
        ) ?? null,
    );
  return { sources, failure, setFailure, busy, change, merge };
}
