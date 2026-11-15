import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { Atom } from 'jotai/vanilla';
import { useEffect, useMemo, useState } from 'react';
import { useService } from '../../../kit/useService.ts';
import type { MusicClientFailureCode } from '../../../playback/musicClient.ts';
import { musicStatusKey } from '../../../playback/musicStatus.ts';
import { SEARCH_ONLINE } from '../../../playback/searchOnlinePref.ts';
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../../server/musicObjects.ts';
import type { MusicSearchKind } from '../../../server/musicProtocol.ts';
import { searchableKinds, type OnlineKindState, type OnlineSearch } from './onlineSearch.ts';

/**
 * 停顿多久才向平台要，毫秒；回车立即进结果页。后端被限流后搜索与专辑、艺人、歌单详情都要冷却一阵，
 * 打字触发的限流会连带打不开刚点开的页面，所以停顿不能再短
 */
const PAUSE_MS = 800;
/** 三类最多等多久，毫秒。到时还没答回的类别算失败，之后到了也不画进这次的下拉，免得把已显示的行往下推 */
const WAIT_MS = 5000;

const PREVIEW_KINDS = ['artist', 'album', 'track'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** 下拉里在线音乐一区的样子；off 时整区不出 */
export type OnlinePreview =
  | { readonly phase: 'off' }
  | { readonly phase: 'waiting'; readonly kinds: readonly PreviewKind[] }
  | {
      readonly phase: 'failed';
      readonly kinds: readonly PreviewKind[];
      readonly failure: MusicClientFailureCode;
    }
  | {
      readonly phase: 'ready';
      readonly kinds: readonly PreviewKind[];
      readonly artists: readonly MusicArtist[];
      readonly albums: readonly MusicAlbum[];
      readonly tracks: readonly MusicTrack[];
    };

export interface OnlinePreviewHandle {
  readonly view: OnlinePreview;
  /** 失败后再取一次：后端连不上时先重连 */
  retry(): void;
}

/**
 * 下拉里在线音乐一区的取数：开着「搜索时包含在线音乐」且有搜索词时，停顿后一起取这个来源能搜的艺人、专辑、曲目，
 * 三类都答回或等满 `WAIT_MS` 才交出。网易云组件没下载时不问，问了也只会答没下载
 */
export function useOnlinePreview(search: OnlineSearch, draft: string): OnlinePreviewHandle {
  const store = useStore();
  const status = useService(musicStatusKey);
  const read = useAtomValueRawSync(status.state);
  const included = useAtomValueRawSync(SEARCH_ONLINE.atom);
  const platform = useAtomValueRawSync(search.platform);
  const states = {
    artist: useAtomValueRawSync(search.kinds.artist),
    album: useAtomValueRawSync(search.kinds.album),
    track: useAtomValueRawSync(search.kinds.track),
  };
  const text = draft.trim();
  const enabled =
    included && !(read.status === 'ready' && read.music.ncm === 'missing' && platform === 'wy');
  const kinds = useMemo(
    () => PREVIEW_KINDS.filter((kind) => searchableKinds(platform).includes(kind)),
    [platform],
  );
  // 重试只对点重试时的那个词立即请求；换了词照旧等停顿
  const [retried, setRetried] = useState({ text: '', count: 0 });
  const round = retried.text === text ? retried.count : 0;
  const [cutoff, setCutoff] = useState<{
    readonly text: string;
    readonly round: number;
    readonly kinds: ReadonlySet<PreviewKind>;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    search.setText(text);
    if (!text) return;
    const pause = round ? 0 : PAUSE_MS;
    const start = setTimeout(() => search.load(kinds), pause);
    const atoms: Readonly<Record<PreviewKind, Atom<OnlineKindState<MusicSearchKind>>>> =
      search.kinds;
    const stop = setTimeout(() => {
      const ready = kinds.filter((kind) => store.get(atoms[kind]).status === 'ready');
      setCutoff({ text, round, kinds: new Set(ready) });
    }, pause + WAIT_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [enabled, search, store, text, kinds, round]);

  const retry = () => {
    const again = () => setRetried({ text, count: round + 1 });
    const failures = kinds.map((kind) => states[kind].failure);
    if (failures.includes('backend-unavailable')) void status.reconnect().then(again);
    else again();
  };
  if (!enabled || !text) return { view: { phase: 'off' }, retry };
  const cut = cutoff?.text === text && cutoff.round === round ? cutoff.kinds : null;
  const settled = (kind: PreviewKind) =>
    states[kind].status === 'ready' || states[kind].status === 'failed';
  if (!cut && !kinds.every(settled)) return { view: { phase: 'waiting', kinds }, retry };
  const shown = kinds.filter((kind) => states[kind].status === 'ready' && (!cut || cut.has(kind)));
  if (!shown.length) {
    const failures = kinds.flatMap((kind) => states[kind].failure ?? []);
    if (failures.length && failures.every((failure) => failure === 'not-installed'))
      return { view: { phase: 'off' }, retry };
    const failure = failures.includes('backend-unavailable')
      ? 'backend-unavailable'
      : (failures[0] ?? 'timeout');
    return { view: { phase: 'failed', kinds, failure }, retry };
  }
  return {
    view: {
      phase: 'ready',
      kinds,
      artists: shown.includes('artist') ? states.artist.items : [],
      albums: shown.includes('album') ? states.album.items : [],
      tracks: shown.includes('track') ? states.track.items : [],
    },
    retry,
  };
}
