import { Portal } from '@fluentui/react-components';
import { Play20Filled } from '@fluentui/react-icons';
import { Provider, useStore } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CoverTheme } from '../../src/covers/CoverTheme.tsx';
import { CoverGlow } from '../../src/covers/CoverGlow.tsx';
import { AccentContext } from '../../src/theme/accentContext.ts';
import { chooseColorMode } from '../../src/theme/colorScheme.ts';
import { ThemeRoot } from '../../src/theme/ThemeRoot.tsx';
import { PrimaryPlayButton } from '../../src/theme/PrimaryPlayButton.tsx';
import { PLAY_BUTTON_STYLES } from '../../src/theme/playButtonColors.ts';
import { choosePlayButtonStyle } from '../../src/theme/playButtonStyle.ts';

function Probe({ name }: { readonly name: string }) {
  const tone = useContext(AccentContext);
  return (
    <div
      data-testid={name}
      data-tone={tone?.argb ?? ''}
      style={{ color: 'var(--accent)', backgroundColor: 'var(--bg-selected)' }}
    >
      {name}
    </div>
  );
}

function CoverThemeHarness() {
  const store = useStore();
  const [url, setUrl] = useState('');
  return (
    <ThemeRoot>
      <input aria-label="封面地址" value={url} onChange={(event) => setUrl(event.target.value)} />
      <Probe name="global" />
      <select
        aria-label="按钮样式"
        defaultValue="soft"
        onChange={(event) => {
          const mode = PLAY_BUTTON_STYLES.find((value) => value === event.target.value);
          if (mode) choosePlayButtonStyle(store, mode, null);
        }}
      >
        {PLAY_BUTTON_STYLES.map((mode) => (
          <option key={mode}>{mode}</option>
        ))}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 120px' }}>
        <CoverTheme url={url}>
          <Probe name="local" />
          <CoverGlow />
          <div data-testid="sibling">sibling</div>
          <PrimaryPlayButton data-testid="play" icon={<Play20Filled />}>
            播放
          </PrimaryPlayButton>
          <PrimaryPlayButton data-testid="disabled-play" disabled>
            播放
          </PrimaryPlayButton>
          <Portal>
            <Probe name="portal" />
          </Portal>
        </CoverTheme>
      </div>
    </ThemeRoot>
  );
}

export function mountCoverThemeHarness(container: HTMLElement): void {
  const store = createStore();
  chooseColorMode(
    store,
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    null,
  );
  createRoot(container).render(
    <Provider store={store}>
      <CoverThemeHarness />
    </Provider>,
  );
}
