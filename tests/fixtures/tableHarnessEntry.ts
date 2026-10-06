import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAppServices as startServices } from '../../src/app/appServices.ts';
import '../../src/styles/global.css';
import { TableHarness } from './TableHarness.tsx';
import { scenarioFrom } from './tableHarnessScenario.ts';

// 试验页在页面里的入口，照 src/main.tsx 的做法在首帧之前建好服务，再挂上试验表。

const container = document.getElementById('root');
if (!container) throw new Error('试验页缺少 #root');
const services = await startServices();
createRoot(container).render(
  createElement(
    StrictMode,
    null,
    createElement(TableHarness, { services, scenario: scenarioFrom(location.search) }),
  ),
);
