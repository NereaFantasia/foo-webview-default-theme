import { atom, type Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref } from '../../../kit/localPref.ts';
import { serviceKey } from '../../../kit/serviceKey.ts';
import type { Store } from '../../../kit/store.ts';
import type { MusicClient } from '../../../playback/musicClient.ts';
import type { MusicStatusService } from '../../../playback/musicStatus.ts';
import type { MusicLxSource } from '../../../server/musicLxSources.ts';
import { MUSIC_PLATFORMS, type MusicPlatform } from '../../../server/musicObjects.ts';
import { ONLINE_PLATFORM } from './onlineSearch.ts';

/** 本地持久化的在线检索来源偏好；记住的来源当前不可用时临时回退到默认平台，不覆盖持久化配置 */
export const ONLINE_SOURCE_PREF = defineLocalPref<MusicPlatform>({
  key: 'default-theme.online-source.v1',
  fallback: ONLINE_PLATFORM,
  ...choiceCodec(MUSIC_PLATFORMS),
});

/** 在线检索来源选项 */
export interface OnlineSourceOption {
  readonly platform: MusicPlatform;
  /** 托管音源服务中无已启用音源支持该平台时为 false，呈现为禁用项 */
  readonly available: boolean;
}

/**
 * 计算在线检索来源选项列表
 * 默认平台始终首位且可用；后端未就绪时仅保留默认平台；托管音源清单不可用（自建服务、请求中或失败）时其他平台保持可选
 */
export function onlineSourceOptions(
  platforms: readonly MusicPlatform[] | null,
  sources: readonly MusicLxSource[] | null,
): readonly OnlineSourceOption[] {
  const options: OnlineSourceOption[] = [{ platform: ONLINE_PLATFORM, available: true }];
  for (const platform of MUSIC_PLATFORMS) {
    if (platform === ONLINE_PLATFORM || !platforms?.includes(platform)) continue;
    options.push({
      platform,
      available:
        sources === null ||
        sources.some((source) => source.enabled && source.platforms.includes(platform)),
    });
  }
  return options;
}

export interface OnlineSources {
  /** 来源菜单选项列表；单一来源时前端收起下拉 */
  readonly options: Atom<readonly OnlineSourceOption[]>;
  /** 当前生效的检索平台：就绪前沿用偏好记录，就绪后若记录项不可用则回退至默认平台 */
  readonly selected: Atom<MusicPlatform>;
  /** 切换检索平台并持久化；忽略不可用或已选中的项 */
  choose(platform: MusicPlatform): void;
  /** 重新拉取托管音源清单，供后端就绪或音源配置变更时同步 */
  refresh(): void;
  dispose(): void;
}

export interface OnlineSourcesDeps {
  readonly status: Pick<MusicStatusService, 'state'>;
  readonly client: Pick<MusicClient, 'lxSources'>;
}

/**
 * 管理在线检索平台选项与用户偏好
 * 结合后端状态与音源清单计算可用平台，支持代数丢弃过期响应，持久化选中项
 */
export function startOnlineSources(store: Store, deps: OnlineSourcesDeps): OnlineSources {
  const lifetime = new AbortController();
  const sources = atom<readonly MusicLxSource[] | null>(null);
  let latest = 0;
  ONLINE_SOURCE_PREF.load(store);

  const options = atom((get) => {
    const read = get(deps.status.state);
    if (read.status !== 'ready') return onlineSourceOptions(null, null);
    return onlineSourceOptions(read.music.platforms, read.music.lxHosted ? get(sources) : null);
  });
  const selected = atom((get) => {
    const remembered = get(ONLINE_SOURCE_PREF.atom);
    // 状态就绪前先沿用偏好记录，避免首屏向默认平台发送冗余请求后又因配置变更重搜
    if (get(deps.status.state).status === 'unknown') return remembered;
    const found = get(options).find((option) => option.platform === remembered);
    return found?.available ? found.platform : ONLINE_PLATFORM;
  });

  function refresh() {
    if (lifetime.signal.aborted) return;
    const mine = ++latest;
    const read = store.get(deps.status.state);
    if (read.status !== 'ready' || !read.music.lxHosted) {
      store.set(sources, null);
      return;
    }
    void deps.client.lxSources({ signal: lifetime.signal }).then(
      (list) => {
        if (mine === latest) store.set(sources, list);
      },
      () => {
        if (mine === latest) store.set(sources, null);
      },
    );
  }
  const stop = store.sub(deps.status.state, refresh);
  refresh();

  return {
    options,
    selected,
    choose(platform) {
      if (!store.get(options).some((option) => option.platform === platform && option.available))
        return;
      ONLINE_SOURCE_PREF.set(store, platform);
    },
    refresh,
    dispose() {
      stop();
      lifetime.abort();
    },
  };
}

export const onlineSourcesKey = serviceKey<OnlineSources>('onlineSources');
