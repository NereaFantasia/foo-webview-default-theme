import { startFrontend } from './app/startFrontend.ts';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html 缺少 #root');
// 服务在这里建、不在组件里建：StrictMode 会把 effect 先清理再重跑一遍，服务会跟着被释放。
// 这一份随页面存活；这条引入链上没有热更新边界，改动服务模块时开发服务器整页重载，不会并存新旧两份。
// 先确认宿主运行方式，再读浏览器偏好的可信副本、挂上业务界面。
const frontend = startFrontend(container);
if (import.meta.hot) import.meta.hot.dispose(() => frontend.dispose());
