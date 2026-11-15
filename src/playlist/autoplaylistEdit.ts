import type { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { conditionOf, type AutoplaylistRules } from '../track/autoplaylist/autoplaylistForm.ts';

// 宿主不支持就地更新自动播放列表规则，必须先解除原有属性再套用新规则
// 为防错误语法清空列表，操作前先读取旧规则作为回滚依据并验证新查询命中数；套用失败时使用旧规则回滚

/** 读列表当前规则的结果：读得到、读不到（第三方提供者、旧式锁、配置解不开、旧版宿主），或这次没问成 */
export type AutoplaylistRead =
  | { readonly status: 'readable'; readonly rules: AutoplaylistRules }
  | { readonly status: 'unreadable' }
  | { readonly status: 'failed' };

/** 保存的结局：`saved` 套上了新规则；`kept` 没成、列表仍是原规则；`lost` 没成、旧规则也没转回去，列表已是普通列表 */
export type AutoplaylistSave = 'saved' | 'kept' | 'lost';

export interface AutoplaylistEditFace extends Pick<HostReadyFace, 'isAvailable'> {
  playlist: Pick<
    typeof fb.playlist,
    'getAutoplaylistQuery' | 'removeAutoplaylist' | 'convertToAutoplaylist'
  >;
  library: Pick<typeof fb.library, 'query'>;
}

const openAtom = atom<string | null>(null);

/** 正在编辑的播放列表 GUID，未处于编辑状态时为 null；对话框由装配层集中挂载并按此状态启闭 */
export const autoplaylistEditAtom: Atom<string | null> = atom((get) => get(openAtom));

export interface AutoplaylistEditService {
  /** 请求编辑这张列表；几处入口（页头的键、横幅、侧边栏的右键菜单）都走它 */
  open(guid: string): void;
  close(): void;
  /** 每次现读，不缓存：用户随时可能在 foobar2000 里改过规则 */
  read(guid: string): Promise<AutoplaylistRead>;
  /**
   * 套用新规则：先读取旧规则作为回滚依据，验证新查询语法后执行替换；
   * 同一时刻仅允许单次保存，操作冲突时返回 kept
   */
  save(guid: string, rules: AutoplaylistRules): Promise<AutoplaylistSave>;
  dispose(): void;
}

export const autoplaylistEditKey = serviceKey<AutoplaylistEditService>('autoplaylistEdit');

export function startAutoplaylistEdit(
  store: Store,
  host: AutoplaylistEditFace,
): AutoplaylistEditService {
  store.set(openAtom, null);
  let disposed = false;
  let busy = false;

  async function read(guid: string): Promise<AutoplaylistRead> {
    if (disposed || !host.isAvailable()) return { status: 'failed' };
    const answer = await settle(() => host.playlist.getAutoplaylistQuery(guid));
    if (!answer || answer.success === false || !answer.isAutoplaylist) return { status: 'failed' };
    // 旧版宿主不返回 `sort`，先看 `query`；读不到的一律当不可读
    if (answer.query === null || typeof answer.sort !== 'string') return { status: 'unreadable' };
    const rules = {
      query: answer.query,
      sort: answer.sort,
      keepSorted: answer.keepSorted ?? false,
    };
    return { status: 'readable', rules };
  }

  const succeeded = (answer: { readonly success?: boolean } | null) =>
    answer !== null && answer.success !== false;

  return {
    open(guid) {
      if (!disposed) store.set(openAtom, guid);
    },
    close() {
      if (!disposed) store.set(openAtom, null);
    },
    read,
    async save(guid, next) {
      if (disposed || busy) return 'kept';
      busy = true;
      try {
        const before = await read(guid);
        if (before.status !== 'readable') return 'kept';
        const checked = await settle(() =>
          host.library.query(conditionOf(next.query), '', 1, ['handle']),
        );
        if (!succeeded(checked)) return 'kept';
        const removed = await settle(() => host.playlist.removeAutoplaylist(guid));
        // 别的组件管的旧式锁宿主放不开：答成功，什么都没改
        if (!removed || removed.success === false || removed.source === 'dui') return 'kept';
        const apply = (rules: AutoplaylistRules) =>
          settle(() =>
            host.playlist.convertToAutoplaylist(guid, rules.query, rules.sort, rules.keepSorted),
          );
        if (succeeded(await apply(next))) return 'saved';
        return succeeded(await apply(before.rules)) ? 'kept' : 'lost';
      } finally {
        busy = false;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
