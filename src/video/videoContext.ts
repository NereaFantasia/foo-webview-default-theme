import { createContext, type ReactNode } from 'react';
import type { Atom } from 'jotai/vanilla';
import type { VideoService } from './videoService.ts';

export interface VideoPlayback {
  readonly connected: boolean;
  readonly playing: boolean;
  readonly canSeek: boolean;
  readonly position: number;
  readonly duration: number;
  readonly title: string;
  readonly cover: string | null;
}

export interface VideoBindings {
  readonly service: VideoService;
  readonly playback: Atom<VideoPlayback>;
  readonly seekBar: ReactNode;
  readonly volume: ReactNode;
  readonly captions: ReactNode;
  readonly expanded: boolean;
  expand(value: boolean): void;
  toggle(): void;
  previous(): void;
  next(): void;
  seek(seconds: number): void;
  stepVolume(up: boolean): void;
  open(): void;
  close(): void;
}

export const VideoContext = createContext<VideoBindings | null>(null);
