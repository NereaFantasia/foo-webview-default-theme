import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../../../kit/serviceKey.ts';
import type { Store } from '../../../kit/store.ts';
import {
  MusicClientError,
  type MusicClient,
  type MusicClientFailureCode,
} from '../../../playback/musicClient.ts';
import type { NcmComponentState } from '../../../server/ncmComponent.ts';

export type NcmSetupState =
  | { readonly status: 'unknown' }
  /** 读不到组件状态：多是后端没连上，或后端没有这项能力 */
  | { readonly status: 'failed'; readonly failure: MusicClientFailureCode }
  | { readonly status: 'ready'; readonly component: NcmComponentState };

export interface NcmSetup {
  readonly state: Atom<NcmSetupState>;
  /** 重读组件状态；之前发出、还没答的读作废 */
  refresh(): void;
  /** 开始下载并安装；后端已在装时不重复下载。答复到后照常跟进进度 */
  install(): Promise<void>;
  dispose(): void;
}

/** 下载与安装途中隔多久问一次进度，毫秒 */
const PROGRESS_MS = 500;

const busy = (state: NcmSetupState) =>
  state.status === 'ready' &&
  (state.component.phase === 'downloading' || state.component.phase === 'installing');

/**
 * 网易云组件的安装状态，整页一份：在线音乐页与搜索结果页的空态共用，下载途中换页不丢进度
 * 后端答下载或安装中时隔 `PROGRESS_MS` 再问，直到装好、失败或释放；不在后台常驻轮询
 */
export function startNcmSetup(
  store: Store,
  client: Pick<MusicClient, 'ncm' | 'installNcm'>,
): NcmSetup {
  const state = atom<NcmSetupState>({ status: 'unknown' });
  const lifetime = new AbortController();
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function show(next: NcmSetupState) {
    if (lifetime.signal.aborted) return;
    store.set(state, next);
    clearTimeout(timer);
    if (busy(next)) timer = setTimeout(refresh, PROGRESS_MS);
  }

  /** 读与开始安装各发一次就算一轮，只有最后一轮的答复算数，免得晚到的旧状态盖掉进度 */
  async function ask(request: (signal: AbortSignal) => Promise<NcmComponentState>) {
    const mine = ++latest;
    try {
      const component = await request(lifetime.signal);
      if (mine === latest) show({ status: 'ready', component });
    } catch (error) {
      if (mine !== latest) return;
      show({
        status: 'failed',
        failure: error instanceof MusicClientError ? error.code : 'backend-unavailable',
      });
    }
  }

  function refresh() {
    if (!lifetime.signal.aborted) void ask((signal) => client.ncm({ signal }));
  }

  return {
    state,
    refresh,
    install: () => ask((signal) => client.installNcm({ signal })),
    dispose() {
      lifetime.abort();
      clearTimeout(timer);
    },
  };
}

export const ncmSetupKey = serviceKey<NcmSetup>('ncmSetup');
