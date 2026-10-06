import { expect, test } from '@playwright/test';
import { openArtists } from '../fixtures/artistsPage.ts';

test('相册只采集同一艺人的有效照片，解析不请求嵌入资源', async ({ page }) => {
  await openArtists(page);
  const requested: string[] = [];
  await page.route('https://**/*', (route) => {
    requested.push(route.request().url());
    return route.abort();
  });
  const result: unknown = await page.evaluate(async (path) => {
    const module: unknown = await import(path);
    if (typeof module !== 'object' || module === null) throw new Error('没有相册模块');
    const read: unknown = Reflect.get(module, 'readLastfmGallery');
    if (typeof read !== 'function') throw new Error('没有相册解析器');
    const id = '1234567890abcdef1234567890abcdef';
    const image = `<img src="https://lastfm-img.freetls.fastly.net/i/u/300x300/${id}.jpg">`;
    const html = `<link rel="canonical" href="https://www.last.fm/music/Queen/+images">
      <ul class="image-list">
        <li><a href="/music/Queen/+images/${id}">${image}</a></li>
        <li><a href="/music/Queen/+images/${id}">${image}</a></li>
        <li><a href="/music/Other/+images/${id}">${image}</a></li>
        <li hidden><a href="/music/Queen/+images/abcdef1234567890abcdef1234567890">${image}</a></li>
        <li><a href="https://evil.example/music/Queen/+images/${id}">${image}</a></li>
      </ul><script>window.__galleryExecuted=true</script>
      <iframe src="https://untrusted.example/frame"></iframe>`;
    return {
      photos: read(html, 'https://www.last.fm/music/Queen'),
      wrong: read(html, 'https://www.last.fm/music/Other'),
      challenge: read('<html>Client Challenge</html>', 'https://www.last.fm/music/Queen'),
      executed: Reflect.get(window, '__galleryExecuted') === true,
    };
  }, '/src/library/biography/online/lastfmGallery.ts');
  expect(result).toEqual({
    photos: [
      {
        url: 'https://lastfm-img.freetls.fastly.net/i/u/770x0/1234567890abcdef1234567890abcdef.jpg',
        pageUrl: 'https://www.last.fm/music/Queen/+images/1234567890abcdef1234567890abcdef',
      },
    ],
    wrong: null,
    challenge: null,
    executed: false,
  });
  expect(requested).toEqual([]);
});
