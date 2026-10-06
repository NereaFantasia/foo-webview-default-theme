import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BackgroundImageLayers } from '../../src/theme/background/BackgroundImageLayers.tsx';

function BackgroundLayersHarness() {
  const [url, setUrl] = useState('');
  return (
    <div>
      <input aria-label="背景层地址" value={url} onChange={(event) => setUrl(event.target.value)} />
      <div data-background-probe style={{ position: 'relative', width: 320, height: 200 }}>
        <BackgroundImageLayers url={url} reduced={false} />
      </div>
    </div>
  );
}

export function mountBackgroundLayersHarness(container: HTMLElement): void {
  createRoot(container).render(<BackgroundLayersHarness />);
}
