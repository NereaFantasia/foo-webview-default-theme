import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ArtistLinksHarness } from './ArtistLinksHarness.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('艺人链接试验页缺少 #root');
createRoot(container).render(createElement(ArtistLinksHarness));
