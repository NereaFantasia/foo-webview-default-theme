import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/App.tsx';
import { startAppServices as startServices } from '../../src/app/appServices.ts';
import '../../src/styles/global.css';

// 整个主窗照 src/main.tsx 挂上，另外在 window 上挂 `__immersive.open()`：不经界面上的入口，直接走到正在播放
// 全屏页。测试经 immersivePage.ts 的 `openImmersive` 调它。
const container = document.getElementById('root');
if (!container) throw new Error('试验页缺少 #root');
const services = await startServices();
Reflect.set(window, '__immersive', {
  open: () => services.history.navigate({ id: 'nowPlaying' }),
});
createRoot(container).render(createElement(StrictMode, null, createElement(App, { services })));
