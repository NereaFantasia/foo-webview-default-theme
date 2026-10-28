import { createStore } from 'jotai/vanilla';
import { Provider } from 'jotai/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayButtonThumb } from '../../../../src/settings/thumbnails/PlayButtonThumb.tsx';
import { globalAccentToneAtom } from '../../../../src/theme/accentState.ts';
import { chooseColorMode } from '../../../../src/theme/colorScheme.ts';
import { PLAY_BUTTON_STYLES, playButtonColors } from '../../../../src/theme/playButtonColors.ts';

/** 画出来的播放键底色，取内联样式里的 background-color。 */
function paintedBackground(html: string): string | undefined {
  return html.match(/data-play-thumb[^>]*style="[^"]*background-color:([^;"]+)/)?.[1]?.trim();
}

describe('PlayButtonThumb', () => {
  it('每种样式的播放键颜色就是播放栏真按钮用的那一份，随深浅变', () => {
    const store = createStore();
    const tone = store.get(globalAccentToneAtom);
    for (const scheme of ['light', 'dark'] as const) {
      chooseColorMode(store, scheme);
      const painted = PLAY_BUTTON_STYLES.map((style) =>
        paintedBackground(
          renderToStaticMarkup(
            <Provider store={store}>
              <PlayButtonThumb style={style} />
            </Provider>,
          ),
        ),
      );
      expect(painted).toStrictEqual(
        PLAY_BUTTON_STYLES.map((style) => playButtonColors(tone, scheme, style).rest.background),
      );
    }
  });
});
