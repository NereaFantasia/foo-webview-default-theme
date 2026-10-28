import type { ComponentType, ReactElement } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SIDEBAR_MODES,
  SIDEBAR_PAGES,
  deriveSceneView,
  type LyricsAvailability,
  type SceneMode,
  type SceneView,
} from '../../src/immersive/scene/sceneState.ts';

/**
 * 预设模板的结构契约：把每个预设放进全部场景状态里静态渲染，查「该有的元素都在、不该有的不在、
 * 当前封面至多一个、DOM 顺序符合约定」。元素在自己的根节点上写 `data-scene-element="名字"`，
 * 名字取 `SCENE_ELEMENTS` 里的；不在表里的标记不管
 */

export const SCENE_MARK = 'data-scene-element';

export const SCENE_ELEMENTS = [
  'cover',
  'info',
  'progress',
  'transport',
  'order',
  'volume',
  'more',
  'tabs',
  'lyrics',
  'queue',
  'history',
  'coverflow',
] as const;
export type SceneElementName = (typeof SCENE_ELEMENTS)[number];

export interface ContractPreset {
  readonly id: string;
  readonly Template: ComponentType<{ readonly scene: SceneView }>;
  /** 模板要服务与主题才画得出来时，由测试给一个把元素画成 HTML 的函数；不给就裸画 */
  readonly render?: (element: ReactElement) => string;
  /** 元素在 DOM 里的先后，只列要卡顺序的几个；此外的元素不限 */
  readonly order?: readonly SceneElementName[];
}

/** 全部场景状态推出的版式，页、侧栏方式、模式、歌词状态、侧栏放不放得下各走一遍 */
export function allSceneViews(): SceneView[] {
  const views: SceneView[] = [];
  const lyricsStates: LyricsAvailability[] = ['pending', 'present', 'absent'];
  const modes: SceneMode[] = ['none', 'coverflow'];
  for (const page of SIDEBAR_PAGES)
    for (const sidebar of SIDEBAR_MODES)
      for (const mode of modes)
        for (const lyrics of lyricsStates)
          for (const sidebarFits of [false, true]) {
            views.push(
              deriveSceneView(
                { page, sidebar, mode, browsed: null },
                { lyrics, sidebarFits, searching: false },
                null,
              ),
            );
          }
  return views;
}

/**
 * 模板这一版式下该有的元素，按页签与侧栏收没收起来。Coverflow 是宿主的模式：模板收到模式里的版式时照常
 * 排自己的（被宿主藏起，页签已收），舞台里的 `coverflow` 与 `info` 由宿主放，模板里不许有 `coverflow`
 */
export function requiredElements(view: SceneView): SceneElementName[] {
  const required: SceneElementName[] = ['cover', 'info', 'progress', 'transport', 'volume', 'more'];
  if (view.showTabs) required.push('tabs');
  if (!view.centered) required.push(view.page);
  return required;
}

/** 可有可无的元素：封面窄时模板按列宽收掉播放顺序键，静态渲染量不到列宽，所以有没有都算过 */
export const OPTIONAL_ELEMENTS: readonly SceneElementName[] = ['order'];

/** 静态渲染的结果里，认得的元素标记按 DOM 顺序 */
export function renderedElements(preset: ContractPreset, view: SceneView): SceneElementName[] {
  const element = createElement(preset.Template, { scene: view });
  const html = preset.render ? preset.render(element) : renderToStaticMarkup(element);
  const marks: SceneElementName[] = [];
  for (const match of html.matchAll(new RegExp(`${SCENE_MARK}="([^"]*)"`, 'g'))) {
    const name = SCENE_ELEMENTS.find((known) => known === match[1]);
    if (name) marks.push(name);
  }
  return marks;
}

function describeView(view: SceneView): string {
  return `${view.mode} ${view.page} 居中${view.centered} 页签${view.showTabs}`;
}

/** 返回违反契约的描述，空数组是全部通过 */
export function checkPreset(
  preset: ContractPreset,
  views: readonly SceneView[] = allSceneViews(),
): string[] {
  const problems: string[] = [];
  for (const view of views) {
    const rendered = renderedElements(preset, view);
    const required = requiredElements(view);
    const optional = OPTIONAL_ELEMENTS;
    const where = `${preset.id} / ${describeView(view)}`;
    for (const name of required) {
      if (!rendered.includes(name)) problems.push(`${where}：缺 ${name}`);
    }
    for (const name of new Set(rendered)) {
      if (!required.includes(name) && !optional.includes(name)) {
        problems.push(`${where}：不该有 ${name}`);
      }
    }
    if (rendered.filter((name) => name === 'cover').length > 1) {
      problems.push(`${where}：当前封面出现多次`);
    }
    if (preset.order) {
      const wanted = preset.order.filter((name) => rendered.includes(name));
      const actual = rendered.filter((name) => wanted.includes(name));
      if (wanted.join() !== actual.join()) {
        problems.push(`${where}：顺序是 ${actual.join('、')}，应为 ${wanted.join('、')}`);
      }
    }
  }
  return [...new Set(problems)];
}
