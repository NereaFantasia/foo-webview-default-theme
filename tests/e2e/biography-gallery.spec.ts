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
    const second = 'abcdef1234567890abcdef1234567890';
    const image = `<img src="https://lastfm-img.freetls.fastly.net/i/u/avatar170s/${id}" loading="lazy">`;
    const html = `<link rel="canonical" href="https://www.last.fm/music/Queen/+images">
      <ul class="image-list">
        <li><a href="/music/Queen/+images/${id}">${image}</a></li>
        <li><a href="/music/Queen/+images/${id}">${image}</a></li>
        <li><a href="/music/Queen/+images/${second}"><img src="https://lastfm-img.freetls.fastly.net/i/u/avatar170s/${second}" loading="lazy"></a></li>
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
      {
        url: 'https://lastfm-img.freetls.fastly.net/i/u/770x0/abcdef1234567890abcdef1234567890.jpg',
        pageUrl: 'https://www.last.fm/music/Queen/+images/abcdef1234567890abcdef1234567890',
      },
    ],
    wrong: null,
    challenge: null,
    executed: false,
  });
  expect(requested).toEqual([]);
});

test('同一照片换裁切后去重，画面内容变化仍保留', async ({ page }) => {
  await openArtists(page);
  const result: unknown = await page.evaluate(
    async (paths) => {
      const identity: unknown = await import(paths.identity);
      const cover: unknown = await import(paths.cover);
      if (typeof identity !== 'object' || !identity || typeof cover !== 'object' || !cover)
        throw new Error('缺少照片比较模块');
      const same: unknown = Reflect.get(identity, 'sameBiographyPhotoPixels');
      const probe: unknown = Reflect.get(cover, 'probeCover');
      if (typeof same !== 'function' || typeof probe !== 'function')
        throw new Error('缺少照片比较方法');
      const original = document.createElement('canvas');
      original.width = 256;
      original.height = 192;
      const context = original.getContext('2d');
      if (!context) throw new Error('缺少绘图上下文');
      const scene = context.createImageData(256, 192);
      for (let y = 0; y < 192; y++) {
        for (let x = 0; x < 256; x++) {
          const at = (y * 256 + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            scene.data[at + channel] =
              110 + 45 * Math.sin(x / 22 + channel) + 45 * Math.cos(y / 20 - channel);
          scene.data[at + 3] = 255;
        }
      }
      context.putImageData(scene, 0, 0);
      const cropped = document.createElement('canvas');
      cropped.width = 256;
      cropped.height = 192;
      const cropContext = cropped.getContext('2d');
      if (!cropContext) throw new Error('缺少绘图上下文');
      cropContext.drawImage(original, 24, 0, 208, 192, 0, 0, 256, 192);
      const originalPixels: unknown = await probe(original.toDataURL());
      const croppedPixels: unknown = await probe(cropped.toDataURL());
      cropContext.fillStyle = '#dc2030';
      cropContext.fillRect(70, 50, 110, 90);
      const changedPixels: unknown = await probe(cropped.toDataURL());
      return {
        sameCrop: same(originalPixels, croppedPixels),
        differentContent: same(originalPixels, changedPixels),
      };
    },
    {
      identity: '/src/library/biography/biographyPhotoSimilarity.ts',
      cover: '/src/covers/coverIdentity.ts',
    },
  );
  expect(result).toEqual({ sameCrop: true, differentContent: false });
});
