import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { START_PLACE_CHOICES } from '../../../../src/nav/startPlace.ts';
import { StartPlaceThumb } from '../../../../src/settings/thumbnails/StartPlaceThumb.tsx';

describe('StartPlaceThumb', () => {
  it('六个地点各画侧边栏里自己的图标，彼此不同', () => {
    const all = START_PLACE_CHOICES.map((place) =>
      renderToStaticMarkup(<StartPlaceThumb place={place} />),
    );
    expect(new Set(all).size).toBe(START_PLACE_CHOICES.length);
    START_PLACE_CHOICES.forEach((place, index) => {
      expect(all[index]).toContain(`data-place="${place}"`);
      expect(all[index]).toContain('<svg');
    });
  });
});
