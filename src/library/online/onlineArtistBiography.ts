import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { LocalAlbum } from '../biography/apple/appleMatch.ts';
import { biographyArtist } from '../biography/biographyModel.ts';
import { startBiographyStack, type BiographyStackShared } from '../biography/biographyStack.ts';
import type { MusicRef } from '../../server/musicObjects.ts';

export interface OnlineArtistBiographyDeps extends BiographyStackShared {
  readonly viewerTop: Atom<number>;
  openSettings(): void;
}

/**
 * 在线艺人的身份键：认定缓存、手选与状态都按它存取。平台里同名不同人是常态，所以不能按艺人名存，
 * 也不能与本地同名的艺人共用；键里带着平台与艺人 ID，名字只用来搜索
 */
export const onlineArtistKey = (ref: MusicRef) => `online:${ref.platform}:${ref.id}`;

const NO_SEEN: ReadonlySet<string> = new Set();

/**
 * 在线艺人页的简介：复用本地艺人页的装配流程（身份认定、艺术照与宽幅图，简介正文优先取自 Apple、缺失时由 Last.fm 补充）
 * 主体由页面登记而非全局当前艺人，艺人专辑来自平台并用于身份认定
 * 同一时刻仅展示一位艺人：后登记的覆盖先登记的，先登记的页面卸载时不清除后来的状态
 */
export function startOnlineArtistBiography(
  store: ReturnType<typeof createStore>,
  deps: OnlineArtistBiographyDeps,
) {
  const current = atom<{ readonly ref: MusicRef; readonly name: string } | null>(null);
  const listed = atom<{
    readonly key: string;
    readonly albums: readonly LocalAlbum[] | null;
  } | null>(null);
  // 合辑类名字与不合格的名字不联网，与本地艺人页一致
  const term = atom((get) => biographyArtist(get(current)?.name ?? ''));
  const subject = atom((get) => {
    const shown = get(current);
    return shown && get(term) ? onlineArtistKey(shown.ref) : null;
  });
  const albums = atom((get) => {
    const shown = get(current);
    const known = get(listed);
    return shown && known && known.key === onlineArtistKey(shown.ref) ? known.albums : null;
  });
  const active = atom((get) => get(current) !== null);
  const stack = startBiographyStack(store, { ...deps, subject, term, active, albums });
  // 本次运行中获取过宽幅图的艺人集合：识别宽幅图需要等待认定与读取缓存，重新进页时避免先展示平台头像再淡出过渡
  // 页面首次渲染时尚未登记艺人，因此提供完整集合供页面按自身身份键查询
  const wideSeen = atom<ReadonlySet<string>>(new Set<string>());
  const heroSeen = atom((get) => (get(stack.enabled) ? get(wideSeen) : NO_SEEN));
  const stopSeen = store.sub(stack.heroSource, () => {
    const key = store.get(subject);
    const seen = store.get(wideSeen);
    if (key !== null && store.get(stack.heroSource) !== null && !seen.has(key))
      store.set(wideSeen, new Set(seen).add(key));
  });
  let token = 0;
  return {
    ...deps,
    ...stack,
    subject,
    /** 本次运行里取到过宽幅图的艺人的身份键（`onlineArtistKey`）；在线内容关着时为空 */
    heroSeen,
    /** 当前显示的这位的名字与引用 */
    current,
    /** 登记正在显示的艺人，返回释放函数；释放时只清自己登记的 */
    show(ref: MusicRef, name: string): () => void {
      token += 1;
      const mine = token;
      store.set(current, { ref, name });
      return () => {
        if (mine === token) store.set(current, null);
      };
    },
    /** 交出他自己的专辑：还没取到传 null，取失败传空表 */
    setAlbums(ref: MusicRef, list: readonly LocalAlbum[] | null): void {
      store.set(listed, { key: onlineArtistKey(ref), albums: list });
    },
    dispose() {
      token += 1;
      stopSeen();
      stack.dispose();
    },
  };
}

export type OnlineArtistBiography = ReturnType<typeof startOnlineArtistBiography>;
