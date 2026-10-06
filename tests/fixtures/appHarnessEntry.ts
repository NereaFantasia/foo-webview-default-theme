import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/App.tsx';
import { choosePlayerBarStyle, PLAYER_BAR_STYLES } from '../../src/theme/playerBarStyle.ts';
import { chooseVolumeScale, VOLUME_SCALES } from '../../src/playback/volumeScale.ts';
import { startAppServices as startServices } from '../../src/app/appServices.ts';
import '../../src/styles/global.css';

// 整个主窗照 src/main.tsx 挂上，另外让浏览器测试能在运行中改偏好：在 window 上挂 `__harness.set(名, 值)`，
// 照设置页的写法调各偏好的写入口，认得这个值答 true。测试经 playerPage.ts 的 `switchPreference` 调它；
// 页面正好在重载时调不到，那边会等它重新挂上再调，不会像派发事件那样悄悄丢掉。

const container = document.getElementById('root');
if (!container) throw new Error('试验页缺少 #root');
const services = await startServices();

function set(name: unknown, value: unknown): boolean {
  if (name === 'player-bar') {
    const style = PLAYER_BAR_STYLES.find((candidate) => candidate === value);
    if (style) choosePlayerBarStyle(services.store, style);
    return style !== undefined;
  }
  if (name === 'volume-scale') {
    const scale = VOLUME_SCALES.find((candidate) => candidate === value);
    if (scale) chooseVolumeScale(services.store, scale);
    return scale !== undefined;
  }
  return false;
}

Reflect.set(window, '__harness', { set });

createRoot(container).render(createElement(StrictMode, null, createElement(App, { services })));
