import type { PanelGroup } from '../../scene/presetPanel.ts';

/**
 * 预设 2 的几组：布局、遮罩、胶囊；每项的键对应 `BLEED_SCHEMA`，控件由声明的种类决定
 *
 * 底部边距放在布局里：它同时定了胶囊离窗底的距离与队列页、历史页那一列的下沿，不只管胶囊。存档键仍叫 `capsuleBottom`
 */
export const BLEED_PANEL: readonly PanelGroup[] = [
  {
    title: 'immersive.group.layout',
    items: [
      { key: 'coverWidth', label: 'immersive.bleed.coverWidth', unit: '%' },
      { key: 'sideStart', label: 'immersive.bleed.sideStart', unit: '%' },
      { key: 'coverShift', label: 'immersive.bleed.coverShift', unit: '%' },
      { key: 'coverZoom', label: 'immersive.bleed.coverZoom', unit: '%' },
      { key: 'focusX', label: 'immersive.bleed.focusX', unit: '%' },
      { key: 'focusY', label: 'immersive.bleed.focusY', unit: '%' },
      { key: 'capsuleBottom', label: 'immersive.bleed.capsuleBottom', unit: 'px' },
    ],
    target: 'cover',
  },
  {
    title: 'immersive.group.mask',
    items: [
      { key: 'feather', label: 'immersive.bleed.feather' },
      { key: 'featherStart', label: 'immersive.bleed.featherStart', unit: '%' },
      { key: 'featherWidth', label: 'immersive.bleed.featherWidth', unit: '%' },
      { key: 'featherHold', label: 'immersive.bleed.featherHold', unit: '%' },
      { key: 'blur', label: 'immersive.bleed.blur', unit: 'px' },
      { key: 'scrimHeight', label: 'immersive.bleed.scrimHeight', unit: '%' },
      { key: 'scrimStrength', label: 'immersive.bleed.scrimStrength', unit: '%' },
    ],
    target: 'cover',
  },
  {
    title: 'immersive.group.capsule',
    items: [
      { key: 'capsuleOpen', label: 'immersive.bleed.capsuleOpen' },
      { key: 'capsuleWidth', label: 'immersive.bleed.capsuleWidth', unit: 'px' },
    ],
    target: 'capsule',
  },
];
