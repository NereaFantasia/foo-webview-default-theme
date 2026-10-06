import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { LyricLine } from '@applemusic-like-lyrics/core';
import { LyricsPlayer } from '../../src/lyrics/LyricsPlayer.tsx';
import { LYRICS_MOTION_PRESET_VALUES } from '../../src/lyrics/lyricsMotion.ts';
import type { LyricsClockFace } from '../../src/lyrics/lyricsDriver.ts';

const container = document.getElementById('root');
if (!container) throw new Error('缺少播放器容器');
container.style.height = '500px';
container.style.width = '360px';
let position = 0;
let track = 0;
type Change = Parameters<Parameters<LyricsClockFace['onChange']>[0]>[0];
const listeners = new Set<(change: Change) => void>();
const clock: LyricsClockFace = {
  state: 'playing',
  position: () => position,
  onChange: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const lines: LyricLine[] = Array.from({ length: 80 }, (_, index) => ({
  words: [{ word: `第${index}句歌词`, startTime: index * 1000, endTime: (index + 1) * 1000 }],
  startTime: index * 1000,
  endTime: (index + 1) * 1000,
  translatedLyric: '',
  romanLyric: '',
  isBG: false,
  isDuet: false,
}));
const root = createRoot(container);
const render = () =>
  root.render(
    createElement(LyricsPlayer, {
      key: track,
      lines: lines.map((line) => ({
        ...line,
        words: line.words.map((word) => ({ ...word, word: `${track}:${word.word}` })),
      })),
      motion: LYRICS_MOTION_PRESET_VALUES.winui,
      clock,
      active: true,
      fontSize: 24,
    }),
  );
Reflect.set(window, '__lyricsProbe', {
  position: (next: number) => {
    position = next;
  },
  seek: (next: number) => {
    position = next;
    for (const listener of listeners) listener({ reason: 'seek', state: 'playing', position });
  },
  track: () => {
    position = 0;
    track++;
    render();
  },
});
render();
