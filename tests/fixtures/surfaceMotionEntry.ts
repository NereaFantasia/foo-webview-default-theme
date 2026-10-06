import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SurfaceMotionHarness } from './SurfaceMotionHarness.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('缺少动效挂载节点');
createRoot(root).render(createElement(StrictMode, null, createElement(SurfaceMotionHarness)));
