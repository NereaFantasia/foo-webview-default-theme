import type { Theme } from '@fluentui/react-components';
import { CURVE, DURATION_MS } from '../motion/timing.ts';
import { TRAY_IDS } from './trayMenu.ts';

/**
 * 自绘托盘菜单的整份样式。
 *
 * 菜单是宿主单开的一张顶层文档：主窗的 CSS 变量到不了那里，`cssReplace` 又关掉了宿主的缺省样式，
 * 所以字体、颜色、圆角与间距都写进这一串，取值按当前深浅从主题对象现算，源码里不出现字面色值。
 * 尺寸（宽高、线宽、焦点环）不是 token，照写像素。
 *
 * 选择器只用宿主公开的挂载点（`.fb-menu`、`.fb-item`、`.fb-item-ico`、`.fb-sep`、`.fb-zone[data-zone]`、
 * `.fb-np-*`、`data-item-id`、`.fb-slider-*`）。标签元素的 `[part="item-label"]` 不在公开清单上，
 * 是宿主菜单脚本建标签时设的，宿主改名不会有提示。
 */
export function trayMenuCss(theme: Theme, dark: boolean): string {
  const playback = '.fb-zone[data-zone="playback"]';
  const playPause = `${playback} .fb-item[data-item-id="${TRAY_IDS.playPause}"]`;
  const font = `'Segoe UI Variable', ${theme.fontFamilyBase}, 'Microsoft YaHei UI', sans-serif`;
  return `
:root { color-scheme: ${dark ? 'dark' : 'light'}; }
#menu, .fb-menu {
  font-family: ${font};
  font-size: ${theme.fontSizeBase300};
  line-height: ${theme.lineHeightBase300};
  color: ${theme.colorNeutralForeground1};
}
.fb-menu {
  box-sizing: border-box;
  padding: ${theme.spacingVerticalSNudge} ${theme.spacingHorizontalXS};
  border: 1px solid ${theme.colorNeutralStroke2};
  border-radius: ${theme.borderRadiusXLarge};
  background: ${theme.colorNeutralBackgroundAlpha2};
  box-shadow: ${theme.shadow16};
}
/* 宿主页尾的调试探针在独立的子菜单窗里没被藏住，cssReplace 下会露出一行字。 */
#probe { display: none !important; }
#menu.in { animation: fb-fade-in ${DURATION_MS.faster}ms ${CURVE.linear.timing}; }
@keyframes fb-fade-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #menu.in { animation: none; } }
/* 根面板的宽由区定死：宿主量尺寸时把 #menu 的宽度钉成 auto，不定死的话歌曲卡的曲名会把面板撑宽撑窄。
   子菜单窗没有区，下限取同一个宽度，两张面板并排时一样宽。 */
.fb-zone { display: flex; flex-direction: column; width: 190px; }
.fb-submenu { min-width: 200px; }
.fb-item {
  display: flex;
  align-items: center;
  gap: ${theme.spacingHorizontalM};
  min-height: 36px;
  padding: 0 ${theme.spacingHorizontalM};
  border-radius: ${theme.borderRadiusMedium};
  cursor: default;
  user-select: none;
}
.fb-item > [part="item-label"] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-item.active, .fb-item:hover { background: ${theme.colorNeutralBackground1Hover}; }
.fb-item:active { background: ${theme.colorNeutralBackground1Pressed}; }
/* 宿主打开菜单、展开子菜单时都把焦点放到第一项，指针打开也一样，浏览器据此画出缺省的焦点框，
   指针移到别的项它还留在原处。键盘走到哪一项由宿主加的 .active 底色表示，焦点框不画。 */
.fb-item:focus { outline: none; }
.fb-item.disabled { color: ${theme.colorNeutralForegroundDisabled}; }
.fb-item-ico { display: inline-flex; width: 20px; height: 20px; flex: 0 0 20px; }
.fb-item-ico svg { width: 20px; height: 20px; fill: currentColor; }
.fb-arrow { margin-left: auto; color: ${theme.colorNeutralForeground3}; }
.fb-sep { height: 1px; margin: ${theme.spacingVerticalSNudge} ${theme.spacingHorizontalS}; background: ${theme.colorNeutralStroke2}; }
.fb-item[data-item-id="${TRAY_IDS.nowPlaying}"] { min-height: 60px; padding: ${theme.spacingVerticalS} ${theme.spacingHorizontalM}; }
.fb-np-cover {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: ${theme.borderRadiusSmall};
  object-fit: cover;
  background: ${theme.colorNeutralBackground3};
}
.fb-np-text { min-width: 0; overflow: hidden; }
.fb-np-title { font-weight: ${theme.fontWeightSemibold}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fb-np-sub {
  color: ${theme.colorNeutralForeground3};
  font-size: ${theme.fontSizeBase200};
  line-height: ${theme.lineHeightBase200};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
${playback} { flex-direction: row; justify-content: center; gap: ${theme.spacingHorizontalS}; padding: ${theme.spacingVerticalSNudge} 0; }
${playback} .fb-item { width: 36px; height: 36px; min-height: 0; padding: 0; justify-content: center; }
${playback} .fb-item [part="item-label"] { display: none; }
${playPause} { width: 44px; background: ${theme.colorBrandBackground}; color: ${theme.colorNeutralForegroundOnBrand}; }
${playPause}:hover, ${playPause}.active { background: ${theme.colorBrandBackgroundHover}; }
${playPause}:active { background: ${theme.colorBrandBackgroundPressed}; }
.fb-item[data-item-id="${TRAY_IDS.exit}"] { color: ${theme.colorPaletteRedForeground1}; }
/* 面板只有 200 宽，音量行的间距与读数列收紧，轨道才留得下九十来像素。 */
.fb-item.fb-slider { gap: ${theme.spacingHorizontalS}; }
.fb-item.fb-slider:hover, .fb-item.fb-slider:active { background: transparent; }
.fb-slider-label { flex: 0 0 auto; color: ${theme.colorNeutralForeground3}; }
.fb-slider-track {
  position: relative;
  flex: 1 1 auto;
  height: 4px;
  border-radius: ${theme.borderRadiusSmall};
  background: ${theme.colorNeutralStrokeAccessible};
}
.fb-slider-fill { position: absolute; top: 0; left: 0; height: 100%; border-radius: ${theme.borderRadiusSmall}; background: ${theme.colorBrandBackground}; }
.fb-slider-thumb {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: ${theme.colorBrandBackground};
  transform: translate(-50%, -50%);
  box-shadow: ${theme.shadow2};
}
.fb-slider-control { position: absolute; inset: 0; }
/* 键盘进入编辑时焦点落在盖住轨道的透明控件上；焦点环改画在滑块上，指针拖动不出环。 */
.fb-slider-control:focus-visible { outline: none; }
.fb-slider-track:has(> .fb-slider-control:focus-visible) .fb-slider-thumb {
  box-shadow: 0 0 0 2px ${theme.colorNeutralBackground1}, 0 0 0 4px ${theme.colorStrokeFocus2};
}
.fb-slider-val { flex: 0 0 auto; min-width: 2em; text-align: right; color: ${theme.colorNeutralForeground3}; font-variant-numeric: tabular-nums; }
.fb-submenu .fb-item.checked::after { content: '\\2713'; margin-left: auto; color: ${theme.colorBrandForeground1}; }
`;
}
