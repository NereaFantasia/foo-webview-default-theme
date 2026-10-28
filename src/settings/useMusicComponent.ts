import { useEffect, useState } from 'react';
import { useService } from '../kit/useService.ts';
import { musicClientKey } from '../playback/musicClient.ts';
import { musicStatusKey } from '../playback/musicStatus.ts';
import type { NcmComponentState } from '../server/ncmComponent.ts';

/** 组件下载与安装进度的轮询间隔（毫秒） */
const PROGRESS_MS = 500;

/**
 * 按需下载组件（网易云、lxserver）的状态监听与安装 hook
 *
 * 激活时获取初始状态，在下载或安装过程中按固定间隔轮询进度，完成后刷新全局音乐服务状态
 */
export function useMusicComponent(active: boolean, component: 'ncm' | 'lx') {
  const client = useService(musicClientKey);
  const status = useService(musicStatusKey);
  const [state, setState] = useState<NcmComponentState | null>(null);
  const [request, setRequest] = useState({ install: false });
  useEffect(() => {
    if (!active) return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let working = false;
    const read = component === 'ncm' ? client.ncm : client.lxComponent;
    const install = component === 'ncm' ? client.installNcm : client.installLx;
    const ask = (installing: boolean) => {
      (installing ? install({ signal }) : read({ signal })).then(
        (next) => {
          if (signal.aborted) return;
          setState(next);
          const busy = next.phase === 'downloading' || next.phase === 'installing';
          if (busy) timer = setTimeout(() => ask(false), PROGRESS_MS);
          else if (working && next.phase === 'installed') status.refresh();
          working = busy;
        },
        () => {
          if (!signal.aborted) setState(null);
        },
      );
    };
    ask(request.install);
    return () => {
      lifetime.abort();
      clearTimeout(timer);
    };
  }, [active, component, client, status, request]);
  return { component: state, install: () => setRequest({ install: true }) };
}
