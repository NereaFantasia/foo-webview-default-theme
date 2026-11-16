import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormatBadge } from '../../../src/track/FormatBadge.tsx';
import type { FormatReading } from '../../../src/track/trackFormat.ts';

const flac = { codec: 'flac', sampleRate: 96000, bitrate: 4608 };
const lossless = (bits: number): FormatReading => ({ lossless: true, bits });

function render(
  reading: FormatReading,
  track: { codec: string; sampleRate: number; bitrate: number } = flac,
  showDetail = true,
): string {
  return renderToStaticMarkup(
    <FormatBadge track={track} reading={reading} size="medium" showDetail={showDetail} />,
  );
}

describe('FormatBadge', () => {
  it('高解析度无损：编码、Hi-Res 块与规格都在，并带 data-hires', () => {
    const html = render(lossless(24));
    expect(html).toContain('FLAC');
    expect(html).toContain('Hi-Res');
    expect(html).toContain('24/96');
    expect(html).toContain('data-hires');
  });

  it('收起规格的窄档：只留编码框，仍用 data-hires 标出高解析度', () => {
    const html = render(lossless(24), flac, false);
    expect(html).toContain('FLAC');
    expect(html).toContain('data-hires');
    expect(html).not.toContain('Hi-Res');
    expect(html).not.toContain('24/96');
  });

  it('CD 规格的无损与有损曲目不带 Hi-Res', () => {
    const cd = { codec: 'flac', sampleRate: 44100, bitrate: 900 };
    expect(render(lossless(16), cd)).not.toContain('Hi-Res');
    expect(render(lossless(16), cd)).not.toContain('data-hires');
    const mp3 = { codec: 'mp3', sampleRate: 48000, bitrate: 320 };
    const lossy = render({ lossless: false, bits: 16 }, mp3);
    expect(lossy).toContain('320k');
    expect(lossy).not.toContain('data-hires');
  });

  it('不知道编码时不渲染', () => {
    expect(render(lossless(24), { ...flac, codec: ' ' })).toBe('');
  });
});
