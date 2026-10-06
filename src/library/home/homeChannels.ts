import { fb } from 'foo-webview-sdk/bridge';
import { atom, type createStore } from 'jotai/vanilla';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { settle } from '../../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../../host/waitForHost.ts';

export const HOME_CHANNELS_KEY = 'defaultTheme.home.channels';
export const CHANNEL_SORTS = ['album', 'title', 'random'] as const;
export type ChannelSort = (typeof CHANNEL_SORTS)[number];
export const CHANNEL_SORT_PATTERNS: Readonly<Record<ChannelSort, string>> = {
  album: '%album artist% | %album% | $num(%discnumber%,4) | $num(%tracknumber%,4)',
  title: '%title% | %artist% | %path%',
  random: '$rand()',
};
export interface HomeChannel {
  readonly id: string;
  readonly name: string;
  readonly query: string;
  readonly sort: ChannelSort;
}
export interface HomeChannelsState {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly items: readonly HomeChannel[];
  readonly saving: boolean;
  readonly saveFailed: boolean;
}

export function parseHomeChannels(raw: unknown): HomeChannel[] | null {
  if (!Array.isArray(raw) || raw.length > 100) return null;
  const result: HomeChannel[] = [];
  const ids = new Set<string>();
  for (const row of raw) {
    if (typeof row !== 'object' || !row || Array.isArray(row)) return null;
    const id: unknown = Reflect.get(row, 'id');
    const name: unknown = Reflect.get(row, 'name');
    const query: unknown = Reflect.get(row, 'query');
    const sort = CHANNEL_SORTS.find((value) => value === Reflect.get(row, 'sort'));
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 100 ||
      ids.has(id) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 120 ||
      typeof query !== 'string' ||
      !query.trim() ||
      query.length > 8000 ||
      !sort
    )
      return null;
    ids.add(id);
    result.push({ id, name, query, sort });
  }
  return result;
}

export interface HomeChannelsHost extends HostReadyFace {
  readonly config: Pick<typeof fb.config, 'get'>;
}

/**
 * 保存成功后才替换列表；读回失败时禁止覆盖未知存档。
 * 写入经公共写入助手，没有传入 `writer` 时每次保存都按失败处理。
 */
export function startHomeChannels(
  store: ReturnType<typeof createStore>,
  host: HomeChannelsHost = fb,
  writer?: Pick<ConfigWriter, 'set'>,
) {
  const state = atom<HomeChannelsState>({
    status: 'loading',
    items: [],
    saving: false,
    saveFailed: false,
  });
  let disposed = false;
  let generation = 0;
  let waiter: ReturnType<typeof waitForHost> | undefined;
  const lifetime = new AbortController();
  const patch = (change: Partial<HomeChannelsState>) =>
    store.set(state, { ...store.get(state), ...change });

  async function restore() {
    if (disposed || store.get(state).saving) return;
    const mine = ++generation;
    patch({ status: 'loading' });
    waiter?.cancel();
    const waiting = waitForHost(host);
    waiter = waiting;
    const arrived = await waiting.done;
    waiting.cancel();
    if (disposed || mine !== generation) return;
    const answer = arrived ? await settle(() => host.config.get(HOME_CHANNELS_KEY)) : null;
    if (disposed || mine !== generation) return;
    const items =
      answer?.success === true ? parseHomeChannels(answer.found ? answer.value : []) : null;
    if (!items) return patch({ status: 'failed' });
    patch({ status: 'ready', items, saveFailed: false });
  }

  async function write(next: readonly HomeChannel[]) {
    // 落盘与成功后显示的是同一份校验得到的副本，不引用调用方传入的对象。
    const items = parseHomeChannels(next);
    if (disposed || store.get(state).status !== 'ready' || store.get(state).saving || !items)
      return false;
    const mine = ++generation;
    patch({ saving: true, saveFailed: false });
    const result = writer
      ? await writer.set(
          HOME_CHANNELS_KEY,
          items.map((item) => ({ ...item })),
          lifetime.signal,
        )
      : null;
    if (disposed || mine !== generation) return false;
    const ok = result?.success === true;
    patch({ saving: false, saveFailed: !ok, ...(ok ? { items } : {}) });
    return ok;
  }
  return {
    state,
    ready: restore(),
    retry: restore,
    async save(channel: HomeChannel, editing = false) {
      const items = store.get(state).items;
      const index = items.findIndex((item) => item.id === channel.id);
      if ((editing && index < 0) || (!editing && index >= 0)) return false;
      return write(
        index < 0
          ? [...items, channel]
          : items.map((item) => (item.id === channel.id ? channel : item)),
      );
    },
    async remove(id: string) {
      const items = store.get(state).items;
      if (!items.some((item) => item.id === id)) return false;
      return write(items.filter((item) => item.id !== id));
    },
    dispose() {
      disposed = true;
      generation += 1;
      waiter?.cancel();
      lifetime.abort();
    },
  };
}

export type HomeChannelsService = ReturnType<typeof startHomeChannels>;
