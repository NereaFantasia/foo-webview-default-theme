import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MiniWindow } from '../../../../src/settings/thumbnails/MiniWindow.tsx';

const markup = (bar: 'bottom' | 'titlebar' | 'capsule') =>
  renderToStaticMarkup(<MiniWindow bar={bar} />);

describe('MiniWindow', () => {
  it('三种播放栏画出三张不同的缩略图，内容卡在底部通栏时矮一截', () => {
    const [bottom, titlebar, capsule] = [markup('bottom'), markup('titlebar'), markup('capsule')];
    expect(new Set([bottom, titlebar, capsule]).size).toBe(3);
    expect(bottom).toContain('height="640"');
    expect(titlebar).toContain('height="736"');
    expect(capsule).toContain('height="736"');
  });

  it('同一页放几张时裁剪的 id 互不重复，不然后画的会借用先画的那份', () => {
    const html = renderToStaticMarkup(
      <>
        <MiniWindow bar="bottom" />
        <MiniWindow bar="capsule" />
      </>,
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('封面占位是灰色骨架块，没有渐变，也不带调色板里的色相', () => {
    for (const bar of ['bottom', 'titlebar', 'capsule'] as const) {
      const html = markup(bar);
      expect(html, bar).not.toContain('linearGradient');
      expect(html, bar).not.toContain('stop-color');
      expect(html, bar).not.toMatch(/Palette/i);
    }
  });

  it('只是示意，对读屏隐藏，不能取得焦点', () => {
    const html = markup('bottom');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
  });
});
