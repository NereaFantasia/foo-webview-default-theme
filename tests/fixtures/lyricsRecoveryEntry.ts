import { DomLyricPlayer, type LyricLine } from '@applemusic-like-lyrics/core';
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { LyricsPlayer } from '../../src/lyrics/LyricsPlayer.tsx';
import { readSavedLyrics } from '../../src/lyrics/lyricsArchive.ts';
import { DEFAULT_LYRICS_DISPLAY } from '../../src/lyrics/lyricsDisplay.ts';
import type { LyricsClockFace } from '../../src/lyrics/lyricsDriver.ts';
import { LYRICS_MOTION_PRESET_VALUES } from '../../src/lyrics/lyricsMotion.ts';
import { parseLyricsText } from '../../src/lyrics/lyricsText.ts';

const container = document.getElementById('root');
if (!container) throw new Error('缺少播放器容器');
document.getElementById('server-loading')?.remove();
container.style.height = '500px';
container.style.width = '600px';
const root = createRoot(container);
const SET_LINES = DomLyricPlayer.prototype.setLyricLines;
const UPDATE = DomLyricPlayer.prototype.update;
const SET_SPRING = DomLyricPlayer.prototype.setEnableSpring;
type Failure = 'load' | 'config' | 'frame' | null;
let failure: Failure = null;
let loaded: LyricLine[] = [];
let updates = 0;
let clicks = 0;
let position = 25.2;
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

DomLyricPlayer.prototype.setLyricLines = function (lines, time) {
  if (failure === 'load') throw new Error('模拟歌词加载失败');
  loaded = structuredClone(lines);
  SET_LINES.call(this, lines, time);
};
DomLyricPlayer.prototype.update = function (delta) {
  updates += 1;
  if (failure === 'frame') throw new Error('模拟逐帧更新失败');
  UPDATE.call(this, delta);
};
DomLyricPlayer.prototype.setEnableSpring = function (enabled) {
  if (failure === 'config') throw new Error('模拟配置更新失败');
  SET_SPRING.call(this, enabled);
};

export const lyricsRecovery = {
  mount(text: string, fault: Failure = null, stored = false) {
    failure = fault;
    const parsed = parseLyricsText(text);
    const content = stored
      ? readSavedLyrics(JSON.stringify({ key: 'song', source: 'embedded', content: parsed }))
          ?.content
      : parsed;
    if (content?.kind !== 'synced') throw new Error('缺少同步歌词');
    root.render(
      createElement(
        Fragment,
        null,
        createElement('button', { id: 'shell-button', onClick: () => clicks++ }, '界面按钮'),
        createElement(LyricsPlayer, {
          lines: content.lines,
          fallback: createElement(
            'div',
            null,
            ...content.lines.map((line, index) =>
              createElement('p', { key: index }, line.words.map((word) => word.word).join('')),
            ),
          ),
          clock,
          active: true,
          motion: LYRICS_MOTION_PRESET_VALUES.winui,
          display: DEFAULT_LYRICS_DISPLAY,
          fontSize: 24,
        }),
      ),
    );
  },
  snapshot: () => ({ loaded, updates, clicks, listeners: listeners.size }),
  failFrame() {
    failure = 'frame';
  },
  seek(next: number) {
    position = next;
    for (const listener of listeners) listener({ reason: 'seek', state: 'playing', position });
  },
};
Reflect.set(window, '__lyricsRecovery', lyricsRecovery);
