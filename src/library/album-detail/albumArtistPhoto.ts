import { atom, type Atom, type createStore } from 'jotai/vanilla';
import type { AlbumsState } from '../albums.ts';
import { localAlbumsOf } from '../biography/biographyInput.ts';
import { biographyArtist } from '../biography/biographyModel.ts';
import { startBiographyStack, type BiographyStackShared } from '../biography/biographyStack.ts';

export interface AlbumArtistPhotoDeps extends BiographyStackShared {
  /** 本地专辑清单：艺人名下的专辑用来在同名候选人里认人，与艺人页的认定一致 */
  readonly albums: Atom<AlbumsState>;
}

/**
 * 专辑详情页头的艺人头像：照艺人页同一套流程取图。来源跟着用户在简介里选的那一个（Apple Music 或 Last.fm），
 * 身份认定、缓存与在线内容开关都共用，艺人页或右侧卡认定过的这位不再重新认定。只取艺术照，不拉宽幅头图与
 * 动态艺术照。主体由页面登记，同一时刻只有一位：后登记的覆盖先登记的，先登记的页面卸载时不清后来的
 */
export function startAlbumArtistPhoto(
  store: ReturnType<typeof createStore>,
  deps: AlbumArtistPhotoDeps,
) {
  const current = atom<string | null>(null);
  // 合辑类名字与不合格的名字不联网，与艺人页一致
  const subject = atom((get) => {
    const name = get(current);
    return name === null ? null : biographyArtist(name);
  });
  const active = atom((get) => get(subject) !== null);
  const albums = atom((get) => localAlbumsOf(get(deps.albums), get(subject)));
  const stack = startBiographyStack(store, { ...deps, subject, active, albums, photoOnly: true });
  let token = 0;
  return {
    /** 头像的图片地址；还在取、这位没有照片或在线内容关着时为 null。照片要与正登记的这位对得上才给 */
    photo: atom((get) =>
      get(subject) !== null && get(stack.photoSource) !== null
        ? (get(stack.onlinePhoto.state).photo?.url ?? null)
        : null,
    ),
    subject,
    /** 登记正在显示的专辑艺人，返回释放函数；释放时只清自己登记的 */
    show(name: string): () => void {
      token += 1;
      const mine = token;
      store.set(current, name);
      return () => {
        if (mine === token) store.set(current, null);
      };
    },
    dispose() {
      token += 1;
      stack.dispose();
    },
  };
}

export type AlbumArtistPhoto = ReturnType<typeof startAlbumArtistPhoto>;
