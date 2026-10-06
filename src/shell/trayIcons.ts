import {
  Album24Regular,
  ArrowRepeat124Regular,
  ArrowRepeatAll24Regular,
  ArrowRepeatAllOff24Regular,
  ArrowShuffle24Regular,
  FolderOpen24Regular,
  MusicNote124Regular,
  Next24Regular,
  Play24Regular,
  Previous24Regular,
  SignOut24Regular,
  Window24Regular,
  type FluentIcon,
} from '@fluentui/react-icons';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { TrayIconName, TrayIconSvg } from '../playback/trayMenu.ts';

/** 托盘菜单每一项的图标。七种顺序与主窗的顺序菜单用同一套，免得看着像两份状态。 */
const TRAY_ICONS: Readonly<Record<TrayIconName, FluentIcon>> = {
  previous: Previous24Regular,
  playPause: Play24Regular,
  next: Next24Regular,
  showMainWindow: Window24Regular,
  exit: SignOut24Regular,
  'order:default': ArrowRepeatAllOff24Regular,
  'order:repeat-playlist': ArrowRepeatAll24Regular,
  'order:repeat-track': ArrowRepeat124Regular,
  'order:random': ArrowShuffle24Regular,
  'order:shuffle-tracks': MusicNote124Regular,
  'order:shuffle-albums': Album24Regular,
  'order:shuffle-folders': FolderOpen24Regular,
};

const SVG_OPEN = /<svg\b[^>]*>/i;
const VIEW_BOX = /\bviewBox="([^"]+)"/;

/** 从一段 `<svg>` 标记里抽出托盘菜单要的 viewBox 与内层；抽不出就不带图标，菜单照常能用。 */
export function iconSvgOf(markup: string): TrayIconSvg | undefined {
  const open = SVG_OPEN.exec(markup);
  const viewBox = open ? VIEW_BOX.exec(open[0])?.[1] : undefined;
  if (!open || !viewBox) return undefined;
  const start = open.index + open[0].length;
  const end = markup.lastIndexOf('</svg>');
  const content = end > start ? markup.slice(start, end).trim() : '';
  return content ? { viewBox, content } : undefined;
}

/**
 * 托盘图标的取值函数。Fluent 的图标只以 React 组件发布，路径数据不单独导出，
 * 所以第一次用到时在一个不挂进页面的节点上同步渲染一遍，取出标记后卸掉，结果缓存起来。
 * 要在 React 的渲染与副作用之外调用：同步渲染不能套在另一次渲染里。
 */
export function createTrayIcons(): (name: TrayIconName) => TrayIconSvg | undefined {
  const cache = new Map<TrayIconName, TrayIconSvg | undefined>();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(createElement(TRAY_ICONS[name])));
    const svg = iconSvgOf(container.innerHTML);
    root.unmount();
    cache.set(name, svg);
    return svg;
  };
}
