import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BackdropThumb,
  SceneThumb,
  type BackdropThumbChoice,
} from '../../../../src/immersive/thumbnails/ViewThumbs.tsx';

const BACKDROPS: readonly BackdropThumbChoice[] = ['mesh', 'titanium', 'isolation', 'off'];
const shotOf = (html: string) => /data-shot="([^"]+)"/.exec(html)?.[1];

describe('SceneThumb', () => {
  it('图纸跟随深浅，浅、深各一张', () => {
    const light = renderToStaticMarkup(<SceneThumb scene="paper" dark={false} />);
    const dark = renderToStaticMarkup(<SceneThumb scene="paper" dark />);
    expect(shotOf(light)).toBe('paper-light');
    expect(shotOf(dark)).toBe('paper-dark');
  });

  it('歌词视图固定深色，深浅主题下是同一张', () => {
    const shots = [false, true].map((dark) =>
      shotOf(renderToStaticMarkup(<SceneThumb scene="presets" dark={dark} />)),
    );
    expect(shots).toEqual(['lyrics', 'lyrics']);
  });
});

describe('BackdropThumb', () => {
  it('四种背景各用各的截图，只有背景渲染器，图本身是示意，对读屏留空', () => {
    const htmls = BACKDROPS.map((choice) =>
      renderToStaticMarkup(<BackdropThumb choice={choice} />),
    );
    expect(htmls.map(shotOf)).toEqual(BACKDROPS.map((choice) => `backdrop-${choice}`));
    expect(new Set(htmls.map((html) => /src="([^"]+)"/.exec(html)?.[1])).size).toBe(4);
    for (const html of htmls) {
      expect(html).toContain('alt=""');
      expect(html).toContain('draggable="false"');
    }
  });
});
