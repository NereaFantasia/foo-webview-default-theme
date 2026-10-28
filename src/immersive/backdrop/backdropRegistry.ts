import {
  BackgroundRender,
  IsolationRenderer,
  MeshGradientRenderer,
  TitaniumRenderer,
} from '@applemusic-like-lyrics/core';
import type { BackdropRendererId } from './backdropChoice.ts';
import { createTitaniumBackdrop } from './titaniumLook.ts';

/** 沉浸视图背景渲染器抽象契约接口 */
export interface BackdropRenderer {
  /** 获取渲染器 canvas DOM 元素 */
  getElement(): HTMLElement;
  /** 更新当前封面图像源；空字符串退回中性底色 */
  setAlbum(source: string): Promise<void>;
  /** 设置渲染分辨率相对物理像素的缩放比例 */
  setRenderScale(scale: number): void;
  /** 设置归一化低频音量（0–1），用于驱动背景流动与脉冲律动 */
  setLowFreqVolume(volume: number): void;
  setFPS(fps: number): void;
  /** 静态节电模式开关；过渡动效结束后冻结帧率调度 */
  setStaticMode(enable: boolean): void;
  setHasLyric(hasLyric: boolean): void;
  dispose(): void;
}

export interface BackdropRendererEntry {
  /** 硬件与环境兼容性探测，结果缓存为单例 */
  supported(): boolean;
  create(): BackdropRenderer;
}

function once(probe: () => boolean): () => boolean {
  let known: boolean | undefined;
  return () => (known ??= probe());
}

export const BACKDROP_RENDERERS: Readonly<Record<BackdropRendererId, BackdropRendererEntry>> = {
  titanium: {
    supported: once(() => TitaniumRenderer.isSupported()),
    create: () => createTitaniumBackdrop(),
  },
  mesh: {
    supported: once(() => MeshGradientRenderer.isSupported()),
    create: () => BackgroundRender.new(MeshGradientRenderer),
  },
  isolation: {
    supported: once(() => IsolationRenderer.isSupported()),
    create: () => BackgroundRender.new(IsolationRenderer),
  },
};
