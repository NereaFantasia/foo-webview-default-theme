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
  /** 正在播的文件的本地路径；在线曲目等没有本地文件时为 null */
  readonly file: string | null;
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
  /** 打开正在播的文件所在的目录；没打开成功时答 false */
  reveal(): Promise<boolean>;
  /** 去文件夹页只看视频；正在播的文件在库里就落在它所在的目录 */
  browse(): void;
  open(): void;
  close(): void;
}

export const VideoContext = createContext<VideoBindings | null>(null);
