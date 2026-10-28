import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createSnapshotSlot, historyAtom, historyKey } from '../../nav/navHistory.ts';
import { sidebarPrefsAtom } from '../../nav/sidebar/sidebarPrefs.ts';
import { sidebarFormOf, sidebarViewAtom } from '../../nav/sidebar/sidebarView.ts';
import { useCommand } from '../../nav/useCommand.ts';
import { albumKeyOf } from '../../host/libraryContract.ts';
import type { SearchSession } from './searchContext.ts';
import { onlineSuggestions, searchSuggestions } from './searchSuggestions.ts';
import { onlinePlayKey, onlineSearchSource } from './online/onlinePlay.ts';
import { blockedTrack, useUnblock } from './online/OnlineItems.tsx';
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
  /** 下拉顶部的范围；换页、开合都不重置，用户切回去为止 */
  readonly scope: 'library' | 'online';
}

/** 在线音乐范围停顿多久才发请求，毫秒；回车立即进结果页 */
const ONLINE_PAUSE_MS = 800;
const SLOT = createSnapshotSlot<SearchSnapshot>();

function sidebarInput(): HTMLInputElement | undefined {
  return [...document.querySelectorAll<HTMLInputElement>('[data-search-input="sidebar"]')].find(
    (input) => !input.closest('[inert]') && input.getBoundingClientRect().width > 0,
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
    scope: 'library',
  });
  const latest = useRef(state);
  const target = useRef<string | null>(null);
  const suppressFocus = useRef(false);
  const update = (patch: Partial<SearchState>) => {
    latest.current = { ...latest.current, ...patch };
    setState(latest.current);
  };
  const online = state.scope === 'online' && !!state.draft.trim();
  const suggestions = online
    ? onlineSuggestions(onlineTracks)
    : searchSuggestions(
        state.draft,
        recent.items,
        albums.map((album) => ({ kind: 'album', album })),
        result.tracks.map((track) => ({ kind: 'track', track })),
        best,
      );
  // 在线音乐范围：词一变先清掉旧结果，停顿够了才向平台要；媒体库范围不发在线请求
  useEffect(() => {
    if (state.scope !== 'online') return;
    const text = state.draft.trim();
    search.onlinePreview.setText(text);
    if (!text) return;
    const timer = setTimeout(() => search.onlinePreview.load(['track']), ONLINE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [search, state.scope, state.draft]);
  const active = suggestions.some((row) => row.key === state.active) ? state.active : null;

  useLayoutEffect(() => {
    if (!state.open) return;
    const input = hasSidebarInput ? sidebarInput() : undefined;
    const mode = input ? 'sidebar' : 'flyout';
    if (latest.current.mode === mode && latest.current.anchor?.isConnected !== false) return;
    latest.current = {
      ...latest.current,
      mode,
      anchor: input ?? document.querySelector<HTMLElement>('[data-search-trigger]'),
      focus: latest.current.focus + 1,
    };
    setState(latest.current);
  }, [state.open, hasSidebarInput, sidebarView.shifting]);

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
          const input = sidebarInput();
          latest.current = {
            ...latest.current,
            ...snapshot,
            mode: input ? 'sidebar' : 'flyout',
            anchor: input ?? null,
            focus: latest.current.focus + 1,
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
    update({ draft: value });
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
  const accept: SearchSession['accept'] = (row) => {
    const chosen = row ?? suggestions.find((item) => item.key === active);
    if (chosen?.online) playOnline(chosen.online);
    else if (chosen?.hit) activate(chosen.hit, latest.current.draft, chosen.hit.kind === 'track');
    else if (latest.current.scope === 'online')
      submit(chosen?.text, { scope: 'online', category: 'all' });
    else submit(chosen?.text);
  };
  return {
    ...state,
    active,
    suggestions,
    show,
    close,
    submit,
    activate,
    leaving,
    accept,
    playOnline,
    setScope(scope) {
      if (scope !== latest.current.scope) update({ scope, active: null });
    },
    focusInput(input, mode) {
      if (!suppressFocus.current)
        update({ open: true, mode, ...(mode === 'sidebar' ? { anchor: input } : {}) });
    },
    edit(text, composing = false) {
      update({ draft: text, active: null, open: true });
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
