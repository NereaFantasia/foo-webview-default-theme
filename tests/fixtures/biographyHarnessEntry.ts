import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BiographyHarness } from './BiographyHarness.tsx';
import '../../src/styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('简介验证页缺少根节点');
createRoot(container).render(createElement(BiographyHarness));
