import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextMenuHarness } from './ContextMenuHarness.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('缺少菜单挂载节点');
createRoot(root).render(createElement(StrictMode, null, createElement(ContextMenuHarness)));
