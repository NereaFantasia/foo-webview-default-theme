import { atom, type Atom } from 'jotai/vanilla';
import type { MessageKey } from '../i18n/en.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { historyAtom, type NavHistoryService } from './navHistory.ts';
import { placeOf, refKey, type ObjectRef } from './objectRef.ts';
import { samePlace } from './places.ts';

/** 进入页面前加载超时阈值，单位毫秒；超过该时间点击位置显示等待动画 */
export const OPEN_SPINNER_DELAY_MS = 300;

/** 对象渲染可用性状态：ready 可交互；pending 索引加载中显示纯文本；missing 目标已失效 */
export type Availability = 'ready' | 'pending' | 'missing';

/**
 * 导航打开结果状态；external 表示交给了应用之外（资源管理器），没有进任何页面；superseded 表示被后续操作中断，
 * disposed 表示服务已销毁
 */
export type OpenResult = 'done' | 'external' | 'missing' | 'failed' | 'superseded' | 'disposed';

/**
 * 进入页面前预取数据结果：`enter` 在进页前执行，之后由服务导航；`settle` 是这个种类自己办完（自己进页，
 * 或交给应用之外），服务不再导航，确认这次打开没被作废后才调它，副作用只在它里面做；失败返回对应错误状态，
 * `notice` 为 null 时不挂提示，由调用方自己说明
 */
export type Prepared =
  | { readonly ok: true; enter(): void }
  | { readonly ok: true; settle(): Promise<'done' | 'external' | 'failed'> }
  | {
      readonly ok: false;
      readonly result: 'missing' | 'failed';
      readonly notice: MessageKey | null;
    };

/** 各类型对象的打开策略接口；无需预取的类型省略 prepare 回调并直接导航 */
export interface KindOpener<R extends ObjectRef> {
  availability(ref: R): Availability;
  /** 索引版本原子，变化时触发可用性状态重新计算 */
  readonly revision?: Atom<unknown>;
  /** 预取 Promise 不得 reject，失败统一返回 ok: false 状态对象 */
  readonly prepare?: (ref: R) => Promise<Prepared>;
  /** 导航之后接着做的事（播放列表要在进历史之后再激活）；目标页已在时也调，不得抛错 */
  readonly arrived?: (ref: R) => void;
}

/** 穷举全部对象类型的打开策略映射表 */
export type KindOpeners = {
  readonly [K in ObjectRef['kind']]: KindOpener<Extract<ObjectRef, { kind: K }>>;
};

export interface ObjectOpening {
  readonly ref: ObjectRef;
  readonly key: string;
  /** 触发来源标识，用于多入口同一对象时准确定位等待指示器 */
  readonly origin: string;
}

export interface ObjectOpener {
  availability(ref: ObjectRef): Availability;
  readonly revision: Atom<unknown>;
  isHere(ref: ObjectRef): boolean;
  /**
   * 导航至指定对象对应的页面地点并追加深入历史记录；已在目标地点时不重复追加
   * 连续调用仅保留最后一次意图；加载失败仅提示通知且不进入页面
   */
  open(ref: ObjectRef, options?: { readonly origin?: string }): Promise<OpenResult>;
  /** 当前正在异步预取且已超过 OPEN_SPINNER_DELAY_MS 延迟的导航操作 */
  readonly pending: Atom<ObjectOpening | null>;
  /** 上一次打开失败的通知键；成功打开新页面时自动清除 */
  readonly notice: Atom<MessageKey | null>;
  dismissNotice(): void;
  dispose(): void;
}

const pendingAtom = atom<ObjectOpening | null>(null);
const noticeAtom = atom<MessageKey | null>(null);

/** 与服务实例属性同步的公共原子，供无服务引用的组件消费 */
export const objectPendingAtom: Atom<ObjectOpening | null> = atom((get) => get(pendingAtom));
export const objectNoticeAtom: Atom<MessageKey | null> = atom((get) => get(noticeAtom));

interface BoundKind {
  availability(): Availability;
  prepare: (() => Promise<Prepared>) | undefined;
  arrived(): void;
}

function bound<R extends ObjectRef>(opener: KindOpener<R>, ref: R): BoundKind {
  const prepare = opener.prepare;
  return {
    availability: () => opener.availability(ref),
    prepare: prepare && (() => prepare(ref)),
    arrived: () => opener.arrived?.(ref),
  };
}

export function startObjectOpener(
  store: Store,
  deps: { readonly history: Pick<NavHistoryService, 'navigate'>; readonly kinds: KindOpeners },
): ObjectOpener {
  store.set(pendingAtom, null);
  store.set(noticeAtom, null);
  const { kinds } = deps;
  let disposed = false;
  let intent = 0;
  /** 发起加载时的历史条目引用；历史发生跳转时废弃本次加载 */
  let openedFrom: object | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function kindOf(ref: ObjectRef): BoundKind {
    switch (ref.kind) {
      case 'album':
        return bound(kinds.album, ref);
      case 'artist':
        return bound(kinds.artist, ref);
      case 'folder':
        return bound(kinds.folder, ref);
      case 'genre':
        return bound(kinds.genre, ref);
      case 'playlist':
        return bound(kinds.playlist, ref);
      case 'onlineList':
        return bound(kinds.onlineList, ref);
      case 'onlineAlbums':
        return bound(kinds.onlineAlbums, ref);
    }
  }

  function stop(): void {
    clearTimeout(timer);
    openedFrom = null;
    if (store.get(pendingAtom) !== null) store.set(pendingAtom, null);
  }

  // 异步加载期间若发生历史导航（如点击侧边栏或后退），取消跳转并丢弃结果
  const offHistory = store.sub(historyAtom, () => {
    if (openedFrom !== null && store.get(historyAtom).entry !== openedFrom) {
      intent += 1;
      stop();
    }
  });

  function enter(ref: ObjectRef, arrived: () => void): OpenResult {
    store.set(noticeAtom, null);
    const place = placeOf(ref);
    // 没有对应页面的引用只能由种类自己办完（`settle`），走到这里是种类表写错了
    if (place === null) return 'failed';
    deps.history.navigate(place, 'drill');
    arrived();
    return 'done';
  }

  const revisions = Object.values(kinds).flatMap((kind) => (kind.revision ? [kind.revision] : []));

  return {
    availability: (ref) => kindOf(ref).availability(),
    revision: atom((get) => revisions.map((revision) => get(revision))),
    isHere(ref) {
      const place = placeOf(ref);
      return place !== null && samePlace(store.get(historyAtom).place, place);
    },
    async open(ref, options) {
      if (disposed) return 'disposed';
      const mine = ++intent;
      stop();
      const { prepare, arrived } = kindOf(ref);
      if (!prepare) return enter(ref, arrived);
      openedFrom = store.get(historyAtom).entry;
      const opening = { ref, key: refKey(ref), origin: options?.origin ?? '' };
      timer = setTimeout(() => {
        if (intent === mine) store.set(pendingAtom, opening);
      }, OPEN_SPINNER_DELAY_MS);
      const prepared = await prepare();
      if (disposed) return 'disposed';
      if (intent !== mine) return 'superseded';
      stop();
      if (!prepared.ok) {
        store.set(noticeAtom, prepared.notice);
        return prepared.result;
      }
      if ('settle' in prepared) {
        store.set(noticeAtom, null);
        return prepared.settle();
      }
      prepared.enter();
      return enter(ref, arrived);
    },
    pending: objectPendingAtom,
    notice: objectNoticeAtom,
    dismissNotice() {
      if (!disposed) store.set(noticeAtom, null);
    },
    dispose() {
      disposed = true;
      stop();
      offHistory();
    },
  };
}

export const objectOpenerKey = serviceKey<ObjectOpener>('objectOpener');
