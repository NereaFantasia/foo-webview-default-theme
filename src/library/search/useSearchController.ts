import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createSnapshotSlot, historyAtom, historyKey } from '../../nav/navHistory.ts';
import { onlineListSubject } from '../../nav/places.ts';
import { sidebarPrefsAtom } from '../../nav/sidebar/sidebarPrefs.ts';
import { sidebarFormOf, sidebarViewAtom } from '../../nav/sidebar/sidebarView.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { albumKeyOf } from '../../host/libraryContract.ts';
import type { SearchSession } from './searchContext.ts';
import { searchSuggestions } from './searchSuggestions.ts';
import { onlinePlayKey, onlineSearchSource } from './online/onlinePlay.ts';
import { blockedTrack, useUnblock } from './online/OnlineItems.tsx';
import { objectTargetOf } from './online/OnlineObjectMenu.tsx';
import { useOnlinePreview } from './online/useOnlinePreview.ts';
import { useService } from '../../kit/useService.ts';
import { searchKey } from './searchServices.ts';
import { albumDetailKey } from '../album-detail/albumDetail.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';

interface SearchSnapshot {
  readonly draft: string;
  readonly open: boolean;
  readonly active: string | null;
}
interface SearchState extends SearchSnapshot {
  readonly anchor: HTMLElement | null;
  readonly mode: 'sidebar' | 'flyout';
  readonly focus: number;
  /** 下拉列表能占的高度，像素；还没量过时为 null，各组按上限列 */
  readonly budget: number | null;
  /** 输入法正在拼字：媒体库与在线音乐都不拿还没上屏的字去搜 */
  readonly composing: boolean;
}

const SLOT = createSnapshotSlot<SearchSnapshot>();

/** 盖在页面上的面板（浏览面板）打这个标记：面板里有搜索框时搜索认它，页面里的那个被盖在底下 */
const FRONT_SURFACE = '[data-front-surface]';

/** 有面板盖在页面上时只认面板里的：面板在图标态时里面没有搜索框，也不该退到被盖住的主窗那一个 */
function sidebarInput(): HTMLInputElement | undefined {
  const usable = [
    ...document.querySelectorAll<HTMLInputElement>('[data-search-input="sidebar"]'),
  ].filter((input) => !input.closest('[inert]') && input.getBoundingClientRect().width > 0);
  const front = document.querySelector(FRONT_SURFACE);
  return front ? usable.find((input) => front.contains(input)) : usable[0];
}

/** 图标态里的放大镜；同样先认盖在页面上的面板里的那个 */
function searchTrigger(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`${FRONT_SURFACE} [data-search-trigger]`) ??
    document.querySelector<HTMLElement>('[data-search-trigger]')
  );
}

export function useSearchController(): SearchSession {
  const search = useService(searchKey);
  const history = useService(historyKey);
  const store = useStore();
  const albumDetail = useService(albumDetailKey);
  const objects = useService(objectOpenerKey);
  const player = useService(onlinePlayKey);
  const unblock = useUnblock();
  const onlineTracks = useAtomValueRawSync(search.onlinePreview.kinds.track).items;
  const result = useAtomValueRawSync(search.preview.state);
  const albums = useAtomValueRawSync(search.preview.albums);
  const best = useAtomValueRawSync(search.preview.best);
  const recent = useAtomValueRawSync(search.recent.state);
  const sidebarView = useAtomValueRawSync(sidebarViewAtom);
  const sidebarPrefs = useAtomValueRawSync(sidebarPrefsAtom);
  const hasSidebarInput =
    sidebarView.overlay || sidebarFormOf(sidebarView.tier, sidebarPrefs) === 'expanded';
  const [state, setState] = useState<SearchState>({
    draft: '',
    open: false,
    active: null,
    anchor: null,
    mode: 'sidebar',
    focus: 0,
    budget: null,
    composing: false,
  });
  const latest = useRef(state);
  const target = useRef<string | null>(null);
  const suppressFocus = useRef(false);
  const update = (patch: Partial<SearchState>) => {
    latest.current = { ...latest.current, ...patch };
    setState(latest.current);
  };
  const online = useOnlinePreview(search.onlinePreview, state.composing ? '' : state.draft);
  const suggestions = searchSuggestions(
    state.draft,
    {
      recent: recent.items,
      albums: albums.map((album) => ({ kind: 'album', album })),
      tracks: result.tracks.map((track) => ({ kind: 'track', track })),
      best,
    },
    online.view.phase === 'off'
      ? null
      : { kinds: online.view.kinds, result: online.view.phase === 'ready' ? online.view : null },
    state.budget,
  );
  const active = suggestions.some((row) => row.key === state.active) ? state.active : null;

  useLayoutEffect(() => {
    if (!state.open) return;
    const found = sidebarInput();
    // 面板里的搜索框不受主窗侧边栏形态约束：主窗把侧边栏藏了，面板里照样有
    const input = found && (hasSidebarInput || found.closest(FRONT_SURFACE)) ? found : undefined;
    const mode = input ? 'sidebar' : 'flyout';
    // 锚点还没解析出来（快照恢复时留空）或已脱离文档时重新解析：没有锚点的下拉会退到窗口左上角
    if (latest.current.mode === mode && latest.current.anchor?.isConnected === true) return;
    latest.current = {
      ...latest.current,
      mode,
      anchor: input ?? searchTrigger(),
      focus: latest.current.focus + 1,
    };
    setState(latest.current);
  }, [state.open, state.anchor, hasSidebarInput, sidebarView.shifting]);

  useLayoutEffect(() => {
    let entry = store.get(historyAtom).entry;
    const bind = () =>
      history.registerSnapshot(entry, SLOT, {
        capture: () => ({
          draft: latest.current.draft,
          open: latest.current.open && target.current !== null,
          active: latest.current.active,
        }),
        restore: (snapshot) => {
          // 恢复发生在历史切换的通知里，面板这时可能还没挂上：形态与锚点留给上面的布局副作用在挂上之后解析
          latest.current = {
            ...latest.current,
            ...snapshot,
            mode: 'flyout',
            anchor: null,
            focus: latest.current.focus + 1,
            composing: false,
          };
          search.preview.setText(snapshot.draft, true);
          setState(latest.current);
        },
      });
    let unbind = bind();
    const off = store.sub(historyAtom, () => {
      const next = store.get(historyAtom);
      if (next.entry === entry) return;
      const saved = SLOT.values.get(entry);
      if (saved && target.current !== `${next.place.id}:${next.place.subject ?? ''}`)
        SLOT.values.set(entry, { ...saved, open: false });
      target.current = null;
      latest.current = { ...latest.current, open: false, active: null };
      setState(latest.current);
      unbind();
      entry = next.entry;
      unbind = bind();
    });
    return () => {
      off();
      unbind();
    };
  }, [history, search, store]);

  useLayoutEffect(() => {
    if (!state.open) return;
    const input =
      state.mode === 'sidebar'
        ? sidebarInput()
        : document.querySelector<HTMLInputElement>('[data-search-input="flyout"]');
    input?.focus({ preventScroll: true });
  }, [state.open, state.mode, state.focus]);

  const show = (text?: string) => {
    const input = sidebarInput();
    // 浮层内的操作只重新聚焦输入框，不能把内部按钮变成定位与返回焦点的锚点
    const anchor = latest.current.open ? latest.current.anchor : document.activeElement;
    if (text !== undefined) search.preview.setText(text);
    update({
      open: true,
      active: null,
      draft: text ?? latest.current.draft,
      ...(text === undefined ? {} : { composing: false }),
      anchor: input ?? (anchor instanceof HTMLElement ? anchor : null),
      mode: input ? 'sidebar' : 'flyout',
      focus: latest.current.focus + 1,
    });
  };
  useCommand({
    id: 'search.focus',
    layer: 'global',
    keys: [{ key: 'f', ctrl: true }],
    run: () => show(),
  });

  const close = (restore = false) => {
    update({ open: false, active: null });
    if (restore) {
      suppressFocus.current = true;
      latest.current.anchor?.focus({ preventScroll: true });
      suppressFocus.current = false;
    }
  };
  const submit: SearchSession['submit'] = (text = latest.current.draft, landing) => {
    const value = text.trim();
    if (!value) return;
    update({ draft: value, composing: false });
    search.preview.setText(value);
    search.recent.remember(value);
    store.set(search.request, landing ? { ...landing, text: value } : null);
    target.current = `search:${value}`;
    history.navigate(
      { id: 'search', subject: value },
      store.get(historyAtom).place.id === 'search' ? 'refresh' : undefined,
    );
    close();
  };
  const activate: SearchSession['activate'] = (hit, text, play = false) => {
    search.recent.remember(text);
    if (hit.kind === 'artist') {
      target.current = `artists:${hit.artist.name}`;
      void objects.open({ kind: 'artist', name: hit.artist.name });
      return;
    }
    const album = hit.kind === 'album' ? hit.album : albumDetail.findAlbum(hit.track);
    if (play || !album) {
      const current = latest.current;
      void search.play(hit).then((ok) => {
        if (ok && latest.current === current) close();
      });
      return;
    }
    target.current = `album:${albumKeyOf(album)}`;
    albumDetail.open(album);
  };
  const leaving: SearchSession['leaving'] = (place, text) => {
    search.recent.remember(text);
    target.current = `${place.id}:${place.subject ?? ''}`;
  };
  /**
   * 下拉里回车播一首在线曲目：与结果页双击一样，带上已取到的这一页。放不出来的（无版权、补全关着）改为
   * 去结果页定位到它，那里写着原因
   */
  const playOnline: SearchSession['playOnline'] = (track) => {
    if (blockedTrack(track, unblock)) {
      submit(latest.current.draft, { scope: 'online', category: 'tracks', focus: track.ref.id });
      return;
    }
    const text = latest.current.draft.trim();
    search.recent.remember(text);
    const current = latest.current;
    void player
      .play(onlineTracks, onlineTracks.indexOf(track), onlineSearchSource(text))
      .then((ok) => {
        if (ok && latest.current === current) close();
      });
  };
  const openOnline: SearchSession['openOnline'] = (item) => {
    const { list } = objectTargetOf(item);
    search.recent.remember(latest.current.draft.trim());
    target.current = `onlineList:${onlineListSubject(list)}`;
    void objects.open({ kind: 'onlineList', list });
  };
  const accept: SearchSession['accept'] = (row) => {
    const chosen = row ?? suggestions.find((item) => item.key === active);
    if (!chosen) return submit();
    switch (chosen.group) {
      case 'recent':
        return submit(chosen.text);
      case 'onlineTracks':
        return playOnline(chosen.track);
      case 'onlineArtists':
        return openOnline(chosen.artist);
      case 'onlineAlbums':
        return openOnline(chosen.album);
      default:
        return activate(chosen.hit, latest.current.draft, chosen.hit.kind === 'track');
    }
  };
  return {
    ...state,
    active,
    suggestions,
    online: online.view,
    show,
    close,
    submit,
    activate,
    leaving,
    accept,
    playOnline,
    openOnline,
    retryOnline: online.retry,
    fit(height) {
      if (height !== latest.current.budget) update({ budget: height });
    },
    focusInput(input, mode) {
      if (!suppressFocus.current)
        update({ open: true, mode, ...(mode === 'sidebar' ? { anchor: input } : {}) });
    },
    edit(text, composing = false) {
      update({ draft: text, active: null, open: true, composing });
      search.preview.setText(composing ? '' : text);
    },
    select: (key) => update({ active: key }),
    step(delta) {
      if (!state.open) show();
      const at = suggestions.findIndex((row) => row.key === active);
      const next = at < 0 && delta < 0 ? suggestions.length - 1 : at + delta;
      update({
        active: suggestions[Math.max(-1, Math.min(suggestions.length - 1, next))]?.key ?? null,
      });
    },
  };
}
