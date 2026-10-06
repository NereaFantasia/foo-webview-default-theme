import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { installTrackInfoDemoHost } from './trackInfoDemoHost.ts';
import '../../src/styles/global.css';

installTrackInfoDemoHost();
const { TrackInfoHarness } = await import('./TrackInfoHarness.tsx');
const container = document.getElementById('root');
if (!container) throw new Error('信息验证页缺少根节点');
createRoot(container).render(createElement(TrackInfoHarness));
