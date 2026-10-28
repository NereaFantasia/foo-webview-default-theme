import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  WaveformThumb,
  type WaveformThumbMode,
} from '../../../../src/immersive/thumbnails/WaveformThumb.tsx';

const MODES: readonly WaveformThumbMode[] = ['rms', 'weighted', 'midHigh', 'layers', 'lanes'];
const markup = (mode: WaveformThumbMode) => renderToStaticMarkup(<WaveformThumb mode={mode} />);
const rects = (html: string) => html.match(/<rect /g)?.length ?? 0;

describe('WaveformThumb', () => {
  it('五种画法各画各的，标记里带画法名', () => {
    const all = MODES.map(markup);
    expect(new Set(all).size).toBe(5);
    MODES.forEach((mode, index) => expect(all[index]).toContain(`data-waveform="${mode}"`));
  });

  it('层数与沉浸视图里的画法对应：单层一层、加底影两层、三层叠画与三道分层各三层', () => {
    const layers = { rms: 1, weighted: 1, midHigh: 2, layers: 3, lanes: 3 } as const;
    for (const mode of MODES) expect(rects(markup(mode)), mode).toBe(layers[mode] * 40);
  });

  it('已播放的一段与其余分开着色，带一条播放头', () => {
    for (const mode of MODES) {
      const html = markup(mode);
      const played = html.match(/class="[^"]*_played_/g)?.length ?? 0;
      const idle = html.match(/class="[^"]*_idle_/g)?.length ?? 0;
      const layers = rects(html) / 40;
      expect(played, mode).toBe(layers * 14);
      expect(idle, mode).toBe(layers * 26);
      expect(html.match(/<line /g)?.length, mode).toBe(1);
    }
  });

  it('单层画法没有热色与底影，三层叠画与三道分层才有热色', () => {
    const tones = (mode: WaveformThumbMode) => {
      const html = markup(mode);
      return {
        shade: /class="[^"]*_shade_/.test(html),
        hot: /class="[^"]*_hot_/.test(html),
      };
    };
    expect(tones('rms')).toEqual({ shade: false, hot: false });
    expect(tones('weighted')).toEqual({ shade: false, hot: false });
    expect(tones('midHigh')).toEqual({ shade: true, hot: false });
    expect(tones('layers')).toEqual({ shade: true, hot: true });
    expect(tones('lanes')).toEqual({ shade: true, hot: true });
  });

  it('三道分层各占一道，从底往上画，互不越道；其余画法以中线上下对称', () => {
    const bounds = (html: string) =>
      [...html.matchAll(/<rect [^>]*\by="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)].map(
        (match) => [Number(match[1]), Number(match[1]) + Number(match[2])] as const,
      );
    const lanes = bounds(markup('lanes'));
    expect(lanes).toHaveLength(120);
    for (const [index, [top, bottom]] of lanes.entries()) {
      const lane = Math.floor(index / 40);
      expect(bottom, `第 ${index} 根`).toBeCloseTo(4 + lane * 32 + 28, 5);
      expect(top).toBeGreaterThanOrEqual(4 + lane * 32 - 1e-9);
    }
    for (const [top, bottom] of bounds(markup('rms')))
      expect((top + bottom) / 2).toBeCloseTo(50, 5);
  });

  it('只是示意，对读屏隐藏', () => {
    expect(markup('rms')).toContain('aria-hidden="true"');
  });
});
