import type { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import type { HostReadyFace } from '../../host/waitForHost.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { Store } from '../../kit/store.ts';
import { QUERY_DEBOUNCE_MS } from '../queryInput.ts';

// 自动播放列表对话框命中数预览：向宿主查询匹配曲目总数；输入去抖请求，过期响应不覆盖新查询

/** 预览结果；`query` 为当前结果对应的查询语句，界面依此校验响应是否匹配当前输入 */
export type AutoplaylistPreview =
  | { readonly status: 'idle' }
  | { readonly status: 'pending'; readonly query: string }
  | { readonly status: 'ready'; readonly query: string; readonly total: number }
  /** 宿主认不出这串查询（`INVALID_PARAMS`） */
  | { readonly status: 'invalid'; readonly query: string }
  /** 别的失败：没连上宿主、查询超时等；不知道命中多少，也不知道查询对不对 */
  | { readonly status: 'failed'; readonly query: string };

const IDLE: AutoplaylistPreview = { status: 'idle' };
const previewAtom = atom<AutoplaylistPreview>(IDLE);

export const autoplaylistPreviewAtom: Atom<AutoplaylistPreview> = atom((get) => get(previewAtom));

export interface AutoplaylistPreviewFace extends Pick<HostReadyFace, 'isAvailable'> {
  library: Pick<typeof fb.library, 'query'>;
}

export interface AutoplaylistPreviewService {
  /**
   * 框里的查询变了：空白就撤掉预览不再问；同一串不重问；否则静默 `QUERY_DEBOUNCE_MS` 后问宿主一次
   * `immediate` 给了就不等静默期（对话框刚打开时预填的那一串）
   */
  request(query: string, immediate?: boolean): void;
  /** 对话框关了：撤掉预览与排着的那一发，下次打开从头问 */
  reset(): void;
  dispose(): void;
}

export const autoplaylistPreviewKey = serviceKey<AutoplaylistPreviewService>('autoplaylistPreview');

export function startAutoplaylistPreview(
  store: Store,
  host: AutoplaylistPreviewFace,
): AutoplaylistPreviewService {
  store.set(previewAtom, IDLE);
  let disposed = false;
  let generation = 0;
  let asked = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    generation += 1;
  }

  async function run(query: string, mine: number): Promise<void> {
    // 只要总数：取一行就够，字段只留句柄
    const answer = await settle(() => host.library.query(query, '', 1, ['handle']));
    if (disposed || mine !== generation) return;
    if (answer && answer.success !== false) {
      store.set(previewAtom, { status: 'ready', query, total: answer.total });
    } else {
      const status = answer?.code === 'INVALID_PARAMS' ? 'invalid' : 'failed';
      store.set(previewAtom, { status, query });
    }
  }

  return {
    request(raw, immediate = false) {
      if (disposed) return;
      const query = raw.trim();
      if (query === asked) return;
      cancel();
      asked = query;
      if (query === '') return void store.set(previewAtom, IDLE);
      if (!host.isAvailable()) return void store.set(previewAtom, { status: 'failed', query });
      store.set(previewAtom, { status: 'pending', query });
      const mine = generation;
      if (immediate) return void run(query, mine);
      timer = setTimeout(() => {
        timer = undefined;
        void run(query, mine);
      }, QUERY_DEBOUNCE_MS);
    },
    reset() {
      if (disposed) return;
      cancel();
      asked = '';
      store.set(previewAtom, IDLE);
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
