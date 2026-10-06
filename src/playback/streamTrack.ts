import type { PlaybackDynamicInfoTrackPayload, Track } from 'foo-webview-sdk';

/**
 * 网络电台放到了哪一首：宿主经 `playback:dynamicInfoTrack` 报出来，文件标签里没有。`key` 是报它时正在放的
 * 那一路流（口径同 `trackKeyOf`），换了一路就作废。
 */
export interface StreamTrack extends PlaybackDynamicInfoTrackPayload {
  readonly key: string;
}

/**
 * 把电台报的曲名与艺人盖在宿主报的标签上，播放栏、窗口标题与托盘都照它显示。只报了曲名时艺人留标签里的
 * （多半是电台名），不沿用上一首报的。
 */
export function withStreamTrack(tagged: Track, stream: StreamTrack | null, key: string): Track {
  if (!stream || stream.key !== key) return tagged;
  return {
    ...tagged,
    title: stream.title ?? tagged.title,
    artist: stream.artist ?? tagged.artist,
    artists: stream.artist ? [stream.artist] : tagged.artists,
  };
}
