import type { LyricsPrefs } from '../lyricsPrefs.ts';
import type { LyricsHttpHost } from './lyricsHttp.ts';
import { createKugouSource } from './kugou.ts';
import { createLrclibSource } from './lrclib.ts';
import { createLrcmuxSource } from './lrcmux.ts';
import { createNeteaseSource } from './netease.ts';
import { createTtmlDbSource } from './ttmlDb.ts';
import { searchOnline } from './lyricsSearch.ts';
import type { LyricsQuery, LyricsSource } from './lyricsSource.ts';

/** 同一实例复用 TTML 索引；创建本身不联网。 */
export function createLyricsSources(host: LyricsHttpHost): LyricsSource[] {
  return [
    createLrclibSource(host),
    createNeteaseSource(host),
    createKugouSource(host),
    createTtmlDbSource(host),
    createLrcmuxSource(host),
  ];
}

export function createLyricsOnline(host: LyricsHttpHost, sources = createLyricsSources(host)) {
  return (query: LyricsQuery, prefs: LyricsPrefs, signal: AbortSignal) => {
    if (!prefs.enabled || signal.aborted) return Promise.resolve(null);
    const selected = (prefs.sources ?? []).flatMap((id) =>
      sources.filter((source) => source.id === id),
    );
    return searchOnline(
      query,
      selected.filter((source) => source.id !== 'lrcmux'),
      {
        mode: 'sequential',
        minimum: 'high',
        fallbacks: selected.filter((source) => source.id === 'lrcmux'),
        signal,
      },
    );
  };
}
