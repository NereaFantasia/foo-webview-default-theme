import type { Track } from 'foo-webview-sdk';

export function trackDisplayTitle(track: Pick<Track, 'title' | 'path'>): string {
  if (track.title) return track.title;
  const name = track.path.split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[^.]+$/, '') || track.path;
}
