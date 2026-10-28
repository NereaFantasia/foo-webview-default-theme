import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackgroundThumb } from '../../../../src/settings/thumbnails/BackgroundThumb.tsx';
import {
  BACKGROUND_TILES,
  type BackgroundTile,
} from '../../../../src/settings/windowBackgroundChoice.ts';

const markup = (tile: BackgroundTile) => renderToStaticMarkup(<BackgroundThumb tile={tile} />);
const artOf = (html: string) => /data-backdrop-art="([^"]+)"/.exec(html)?.[1];

describe('BackgroundThumb', () => {
  it('五张来源图各画各的，标记里带来源名', () => {
    const all = BACKGROUND_TILES.map(markup);
    expect(new Set(all).size).toBe(5);
    BACKGROUND_TILES.forEach((tile, index) => expect(all[index]).toContain(`data-tile="${tile}"`));
  });

  it('只有一幅画：图片与系统材质用画本身，封面与色场是它喂给渲染器后的画面，主题色不借画', () => {
    expect(BACKGROUND_TILES.map((tile) => artOf(markup(tile)))).toEqual([
      undefined,
      'art',
      'cover',
      'palette',
      'art',
    ]);
  });

  it('只有系统材质画比桌面小一圈的窗口；没有各自画的渐变与调色板色相', () => {
    for (const tile of BACKGROUND_TILES) {
      const html = markup(tile);
      expect(/class="[^"]*window/.test(html), tile).toBe(tile === 'material');
      expect(html, tile).not.toContain('linearGradient');
      expect(html, tile).not.toContain('stop-color');
    }
  });

  it('几张同屏时骨架屏里没有要按 id 引用的定义，不会互相借用', () => {
    const html = renderToStaticMarkup(
      <>
        {BACKGROUND_TILES.map((tile) => (
          <BackgroundThumb key={tile} tile={tile} />
        ))}
      </>,
    );
    expect(html).not.toMatch(/\bid="/);
  });

  it('只是示意，对读屏隐藏', () => {
    expect(markup('image')).toContain('aria-hidden="true"');
    expect(markup('cover')).toContain('alt=""');
  });
});
