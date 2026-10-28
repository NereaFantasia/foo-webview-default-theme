import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LYRICS_ALIGN_ANCHORS } from '../../../../src/lyrics/lyricsMotion.ts';
import { LyricsPositionThumb } from '../../../../src/settings/thumbnails/LyricsPositionThumb.tsx';

const markup = (anchor: (typeof LYRICS_ALIGN_ANCHORS)[number]) =>
  renderToStaticMarkup(<LyricsPositionThumb anchor={anchor} />);

describe('LyricsPositionThumb', () => {
  it('顶部、中部、底部各画各的，标记里带停靠位置', () => {
    const all = LYRICS_ALIGN_ANCHORS.map(markup);
    expect(new Set(all).size).toBe(3);
    LYRICS_ALIGN_ANCHORS.forEach((anchor, index) =>
      expect(all[index]).toContain(`data-anchor="${anchor}"`),
    );
  });

  it('三张画的是同一列歌词，只有当前句一行是正中的，其余按与它的距离往两边排', () => {
    for (const anchor of LYRICS_ALIGN_ANCHORS) {
      const html = markup(anchor);
      const distances = [...html.matchAll(/data-distance="(\d+)"/g)].map((match) =>
        Number(match[1]),
      );
      expect(distances, anchor).toEqual([6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6]);
    }
    const texts = LYRICS_ALIGN_ANCHORS.map((anchor) =>
      [...markup(anchor).matchAll(/>([^<]+)<\/span>/g)].map((match) => match[1]),
    );
    expect(texts[1]).toEqual(texts[0]);
    expect(texts[2]).toEqual(texts[0]);
  });
});
