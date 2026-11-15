import {
  BackgroundRender,
  IsolationRenderer,
  MeshGradientRenderer,
  TitaniumRenderer,
  type BaseRenderer,
} from '@applemusic-like-lyrics/core';
import type { BackdropOptionPatch } from './backdropOptions.ts';
import type { BackdropRendererId } from './backdropChoice.ts';
import { createFlowBackdrop } from './flowBackdrop.ts';
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
  /** 流动速度倍率，1 是上游缺省，越大越快 */
  setFlowSpeed(speed: number): void;
  /** 渲染器自己的可调项，已换成上游的名字与单位；不认识的项忽略，网格渐变没有可调项 */
  setOptions(patch: BackdropOptionPatch): void;
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

/**
 * 在上游包装对象上扩充 `setOptions` 方法：各渲染器的配置参数未声明在统一接口，需获取具体渲染器实例下发
 * 直接挂载在原包装对象上，其余生命周期方法仍沿用既有包装逻辑
 */
function withOptions<R extends BaseRenderer>(
  host: BackgroundRender<R>,
  apply: (renderer: R, patch: BackdropOptionPatch) => void,
) {
  return Object.assign(host, {
    setOptions: (patch: BackdropOptionPatch) => apply(host.getRenderer(), patch),
  });
}

export const BACKDROP_RENDERERS: Readonly<Record<BackdropRendererId, BackdropRendererEntry>> = {
  titanium: {
    supported: once(() => TitaniumRenderer.isSupported()),
    create: () =>
      createTitaniumBackdrop(() =>
        withOptions(BackgroundRender.new(TitaniumRenderer), (renderer, patch) =>
          renderer.setOptions(patch),
        ),
      ),
  },
  mesh: {
    supported: once(() => MeshGradientRenderer.isSupported()),
    create: () => withOptions(BackgroundRender.new(MeshGradientRenderer), () => {}),
  },
  isolation: {
    supported: once(() => IsolationRenderer.isSupported()),
    create: () =>
      withOptions(BackgroundRender.new(IsolationRenderer), (renderer, patch) =>
        renderer.setOptions(patch),
      ),
  },
  // 窗口背景的流动色场；只要环境给得出 WebGL2 就能用
  flow: {
    supported: once(() => document.createElement('canvas').getContext('webgl2') !== null),
    create: () => createFlowBackdrop(),
  },
};
