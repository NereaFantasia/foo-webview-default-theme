import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { BIOGRAPHY_PREFS_KEY } from '../../src/library/biography/biographyPrefs.ts';
import { BIOGRAPHY_SOURCE_KEY } from '../../src/library/biography/biographySourcePrefs.ts';
import { PLAYER_BAR_STORAGE_KEY } from '../../src/theme/playerBarStyle.ts';
import {
  lookupAnswer,
  searchAnswer,
  type CatalogAlbum,
  type CatalogArtist,
} from '../fixtures/appleCatalog.ts';
import {
  APPLE_HLS_WIDE,
  APPLE_LOGO,
  APPLE_THUMB,
  appleHeader,
  appleLinked,
  applePageHtml,
} from '../fixtures/applePages.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { selectLastfmSource } from '../fixtures/biographySource.ts';
import { hostFailure } from '../fixtures/hostAnswers.ts';
import { biographyHtml } from '../fixtures/biographySamples.ts';
import { apiReply } from '../fixtures/lastfmApiSamples.ts';
import {
  artistSample,
  candidateSample,
  NUJABES,
  releaseGroupsSample,
  searchSample,
} from '../fixtures/musicbrainzSamples.ts';
import type { PageHost } from '../fixtures/pageHost.ts';

/** 1×1 的 PNG：图片请求都答它，只要能解码、能量出宽高比 */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const HERO_BASE = 'https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/aa/bb/cc/hero.jpg';

interface Entry {
  readonly artist: CatalogArtist;
  readonly albums: readonly CatalogAlbum[];
  readonly bio: string;
  readonly header?: Record<string, unknown>;
}

/** 本地的 Nujabes 有 Modal Soul（2005）与 Metaphorical Music（2003）两张 */
const FIRST: Entry = {
  artist: { id: 111, name: 'Nujabes', genre: 'Hip-Hop' },
  albums: [{ title: 'Modal Soul', year: 2005, tracks: 2 }],
  bio: 'Nujabes was a Japanese record producer and DJ from Tokyo.',
};
/** 同名的另一位：只有标题对得上，年份不对，是弱证据 */
const SECOND: Entry = {
  artist: { id: 222, name: 'Nujabes', genre: 'Jazz' },
  albums: [{ title: 'Modal Soul', year: 1999, tracks: 12 }],
  bio: 'A different artist who happens to share the same name.',
};
const SEARCHED: Entry = {
  artist: { id: 333, name: 'Seba Jun', genre: 'Jazz' },
  albums: [{ title: 'Spiral', year: 2004, tracks: 8 }],
  bio: 'Jun Seba is the producer who runs the Hydeout label.',
};

function pageOf(entry: Entry) {
  const id = String(entry.artist.id);
  return applePageHtml({
    id,
    linked: appleLinked({ name: entry.artist.name, description: entry.bio }, id),
    header: appleHeader(entry.header ?? {}, id),
  });
}

type Reply = ReturnType<typeof apiReply>;

/**
 * 宿主替身里的 Apple：iTunes 搜索按关键词答，Lookup 按艺人 ID 答，艺人页按 ID 答，图片一律答同一张
 * 别的地址交给 `others`，它不答的一律 404
 */
function apple(
  host: PageHost,
  search: Readonly<Record<string, readonly Entry[]>>,
  all: readonly Entry[],
  others?: (url: URL) => Reply | undefined,
) {
  const byId = new Map(all.map((entry) => [String(entry.artist.id), entry] as const));
  host.answer('http.get', (params) => {
    const url = new URL(String(params['url']));
    if (url.hostname === 'itunes.apple.com' && url.pathname === '/search') {
      const term = url.searchParams.get('term') ?? '';
      return apiReply(searchAnswer(...(search[term] ?? []).map((entry) => entry.artist)));
    }
    if (url.hostname === 'itunes.apple.com' && url.pathname === '/lookup') {
      const found = (url.searchParams.get('id') ?? '').split(',').flatMap((id) => {
        const entry = byId.get(id);
        return entry ? [entry] : [];
      });
      return apiReply(
        lookupAnswer(
          Object.fromEntries(
            found.map((entry) => [entry.artist.id, { artist: entry.artist, albums: entry.albums }]),
          ),
        ),
      );
    }
    if (url.hostname === 'music.apple.com') {
      const entry = byId.get(/(\d+)\/?$/.exec(url.pathname)?.[1] ?? '');
      return entry
        ? {
            success: true as const,
            status: 200,
            headers: {},
            body: pageOf(entry),
            responseType: 'text' as const,
          }
        : {
            success: true as const,
            status: 404,
            headers: {},
            body: '',
            responseType: 'text' as const,
          };
    }
    if (url.hostname.endsWith('mzstatic.com'))
      return {
        success: true as const,
        status: 200,
        headers: { 'Content-Type': 'image/png' },
        body: PNG,
        responseType: 'base64' as const,
      };
    return others?.(url) ?? apiReply({}, 404);
  });
}

async function start(
  page: Page,
  search: Readonly<Record<string, readonly Entry[]>>,
  all: readonly Entry[],
  configure?: (host: PageHost) => void,
  others?: (url: URL) => Reply | undefined,
) {
  const env = await openArtists(page, 1400, (host) => {
    host.config.set(BIOGRAPHY_PREFS_KEY, {
      version: 1,
      enabled: true,
      language: 'en',
      identities: [],
    });
    apple(host, search, all, others);
    configure?.(host);
  });
  await env.artist('Nujabes').click();
  return { ...env, about: env.view.locator('[data-artist-about]') };
}

test('自动认定：来源是 Apple Music，来源行末有「不是该艺人」，点后改列候选', async ({ page }) => {
  const env = await start(page, { Nujabes: [FIRST] }, [FIRST]);
  await expect(env.about.getByText(FIRST.bio)).toBeVisible();
  const sources = env.about.locator('[data-biography-sources]');
  await expect(sources.getByText('Apple Music', { exact: true })).toBeVisible();
  await expect(sources).not.toContainText('Last.fm');
  // Apple 来源下工具栏没有重新确认键，入口只有来源行末这一个
  await expect(env.about.getByRole('button', { name: '重新确认艺人' })).toHaveCount(0);
  await sources.getByRole('button', { name: '不是该艺人' }).click();
  await expect(env.about.locator('[data-apple-candidate="111"]')).toBeVisible();
  await expect(env.about.getByText(FIRST.bio)).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('同名两位：直接认证据多的那位，不列候选；点「不是该艺人」后被否定的沉底、标出重合的专辑，选另一位后存成手选，简介按这位取', async ({
  page,
}) => {
  const env = await start(page, { Nujabes: [FIRST, SECOND] }, [FIRST, SECOND]);
  await expect(env.about.getByText(FIRST.bio)).toBeVisible();
  await expect(env.about.locator('[data-apple-candidate]')).toHaveCount(0);
  await env.about
    .locator('[data-biography-sources]')
    .getByRole('button', { name: '不是该艺人' })
    .click();
  const rows = env.about.locator('[data-apple-candidate]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('data-apple-candidate', '222');
  await expect(rows.last()).toHaveAttribute('data-apple-candidate', '111');
  await expect(rows.last()).toContainText('Hip-Hop');
  await expect(rows.last()).toContainText('与本地重合：Modal Soul');
  await env.about.locator('[data-apple-candidate="222"]').click();
  await expect(env.about.getByText(SECOND.bio)).toBeVisible();
  await expect
    .poll(() => env.host.config.get(BIOGRAPHY_SOURCE_KEY))
    .toMatchObject({
      version: 1,
      identities: [{ artist: 'Nujabes', sourceId: '222', sourceArtist: 'Nujabes' }],
    });
  expect(env.errors).toEqual([]);
});

test('搜索其他艺人：预填本地艺人名，按 Enter 才搜，没有结果写明关键词，选一位后简介按这位取', async ({
  page,
}) => {
  const env = await start(page, { Nujabes: [FIRST, SECOND], 'Seba Jun': [SEARCHED] }, [
    FIRST,
    SECOND,
    SEARCHED,
  ]);
  await env.about
    .locator('[data-biography-sources]')
    .getByRole('button', { name: '不是该艺人' })
    .click();
  await expect(env.about.locator('[data-apple-candidate]')).toHaveCount(2);
  await env.about.getByRole('button', { name: '搜索其他艺人' }).click();
  const box = env.about.getByRole('textbox', { name: '艺人名' });
  await expect(box).toHaveValue('Nujabes');
  // 没按 Enter 之前不发搜索：输入不会触发请求
  const searches = () =>
    env.host.callsTo('http.get').filter((call) => String(call['url']).includes('/search'));
  const before = searches().length;
  await box.fill('zzz');
  expect(searches()).toHaveLength(before);
  await box.press('Enter');
  await expect(env.about.getByText('没有找到「zzz」')).toBeVisible();
  await box.fill('Seba Jun');
  await box.press('Enter');
  const found = env.about.locator('[data-apple-search] [data-apple-candidate="333"]');
  await expect(found).toBeVisible();
  // 手动搜的不比对本地专辑，没有「与本地重合」
  await expect(found).not.toContainText('与本地重合');
  await found.click();
  await expect(env.about.getByText(SEARCHED.bio)).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('不关联任何艺人：简介不再出，留下搜索与粘贴链接两个入口；粘贴链接后重新认定', async ({
  page,
}) => {
  const env = await start(page, { Nujabes: [FIRST, SECOND] }, [FIRST, SECOND]);
  await env.about
    .locator('[data-biography-sources]')
    .getByRole('button', { name: '不是该艺人' })
    .click();
  await env.about.getByRole('button', { name: '不关联任何艺人' }).click();
  const identity = env.about.locator('[data-apple-identity="declined"]');
  await expect(identity.getByRole('button', { name: '搜索其他艺人' })).toBeVisible();
  await expect(identity.getByRole('button', { name: '不关联任何艺人' })).toHaveCount(0);
  await expect(env.about.locator('[data-apple-candidate]')).toHaveCount(0);
  await identity.getByRole('button', { name: '粘贴 Apple 艺人链接' }).click();
  const link = env.about.getByRole('textbox', { name: 'Apple Music 艺人链接' });
  await link.fill('https://example.com/not-apple');
  await env.about.getByRole('button', { name: '确认艺人' }).click();
  await expect(
    env.about.getByText('请输入 music.apple.com 或 itunes.apple.com 的艺人链接'),
  ).toBeVisible();
  await link.fill('https://music.apple.com/cn/artist/nujabes/111');
  await env.about.getByRole('button', { name: '确认艺人' }).click();
  await expect(env.about.getByText(FIRST.bio)).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('查无此人：写明没找到，仍可搜索与粘贴链接', async ({ page }) => {
  const env = await start(page, {}, []);
  await expect(env.about.getByText('Apple Music 上未找到该艺人')).toBeVisible();
  await expect(env.about.getByRole('button', { name: '搜索其他艺人' })).toBeVisible();
  await expect(env.about.getByRole('button', { name: '粘贴 Apple 艺人链接' })).toBeVisible();
  await expect(env.about.getByRole('button', { name: '不关联任何艺人' })).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('有宽幅图：整幅铺满头部、画在外框的背景层，不画圆形头像', async ({ page }) => {
  const wide = {
    ...FIRST,
    header: {
      wideArtwork: {
        cropStyle: 'vf',
        dictionary: { url: `${HERO_BASE}/{w}x{h}{c}.{f}`, width: 2400, height: 2400 },
      },
    },
  };
  const env = await start(page, { Nujabes: [wide] }, [wide]);
  const hero = env.view.locator('[data-artist-hero]');
  await expect(hero).toBeVisible();
  await expect(env.view.locator('[data-artist-header]')).toHaveAttribute('data-shape', 'wide');
  await expect(env.view.locator('[data-artist-header] button[data-away]')).toHaveCount(1);
  // 图在滚动区外面：滚动条叠在图上，图不为它让位
  await expect(env.view.locator('[data-detail-scroller] [data-artist-hero]')).toHaveCount(0);
  await expect(env.view.locator('[data-detail-backdrop] [data-artist-hero]')).toHaveCount(1);
  const request = env.host
    .callsTo('http.get')
    .map((call) => String(call['url']))
    .find((url) => url.includes('/1600x900vf.jpg'));
  expect(request).toBe(`${HERO_BASE}/1600x900vf.jpg`);
  expect(env.errors).toEqual([]);
});

test('有宽幅图：往下滚光晕随头图上移，到色块上沿贴住视口顶就粘住；播放栏放标题栏（带导航行）时也是', async ({
  page,
}) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'titlebar'), PLAYER_BAR_STORAGE_KEY);
  const wide = {
    ...FIRST,
    header: {
      wideArtwork: {
        cropStyle: 'vf',
        dictionary: { url: `${HERO_BASE}/{w}x{h}{c}.{f}`, width: 2400, height: 2400 },
      },
    },
  };
  const env = await start(page, { Nujabes: [wide] }, [wide]);
  // 带导航行的外壳把光晕的滚动系数设成 0：粘住的位移不能乘它，否则光晕钉在原处
  await expect(page.locator('[data-with-nav-row]')).toHaveCount(1);
  await expect(env.view).toHaveAttribute('data-backdrop', 'true');
  // 窗口矮一些，滚动区才够长，能滚过粘住的距离
  await page.setViewportSize({ width: 1400, height: 420 });
  const scroller = env.view.locator('[data-detail-scroller]');
  const glow = env.view.locator('[data-cover-glow]');
  const glowTop = () =>
    glow.evaluate(
      (node) =>
        node.getBoundingClientRect().top - (node.parentElement?.getBoundingClientRect().top ?? 0),
    );
  const scrollTo = (top: number) =>
    scroller.evaluate((node, value) => {
      node.scrollTop = value;
    }, top);
  const stick = await glow.evaluate((node) =>
    parseFloat(node.style.getPropertyValue('--detail-glow-stick')),
  );
  const reach = await scroller.evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(stick).toBeGreaterThan(100);
  // 前提：页面能滚过粘住的距离，下面两段才分得出「还在动」与「已粘住」
  expect(reach).toBeGreaterThan(stick + 40);
  expect(await glowTop()).toBeCloseTo(0, 0);
  // 粘住之前与内容同速上移
  await scrollTo(100);
  await expect.poll(glowTop).toBeCloseTo(-100, 0);
  // 滚过粘住的距离后停在 -stick，继续往下滚也不再动
  await scrollTo(stick + 40);
  await expect.poll(glowTop).toBeCloseTo(-stick, 0);
  await scrollTo(reach);
  await expect.poll(glowTop).toBeCloseTo(-stick, 0);
  expect(env.errors).toEqual([]);
});

/** 4 秒的 H.264 小片子（128×72，每帧颜色都在变），顶替 Apple 的动态艺术照 mp4 */
const MOTION_CLIP = readFileSync(
  fileURLToPath(new URL('../fixtures/motionClip.mp4', import.meta.url)),
);
const MOTION_DIR = APPLE_HLS_WIDE.slice(0, APPLE_HLS_WIDE.lastIndexOf('/'));
const MOTION_MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=500000,BANDWIDTH=520000,VIDEO-RANGE=SDR,CODECS="avc1.64001f",RESOLUTION=1280x720',
  'P2_video.m3u8',
].join('\n');
const MOTION_MEDIA = [
  '#EXTM3U',
  '#EXT-X-MAP:URI="P2_video-.mp4",BYTERANGE="878@0"',
  '#EXTINF:4,',
  '#EXT-X-BYTERANGE:13000@878',
  'P2_video-.mp4',
].join('\n');

test('动态艺术照：读出 mp4 地址后静帧上淡入视频；光晕取视频的画面、播放时跟着取样，视频停了它停在最后一帧', async ({
  page,
}) => {
  await page.route(`${MOTION_DIR}/P2_video-.mp4`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'video/mp4', 'access-control-allow-origin': '*' },
      body: MOTION_CLIP,
    }),
  );
  const env = await start(page, { Nujabes: [FIRST] }, [FIRST], undefined, (url) => {
    if (url.hostname !== 'mvod.itunes.apple.com') return undefined;
    const body = url.pathname.endsWith('/P2_default.m3u8')
      ? MOTION_MASTER
      : url.pathname.endsWith('/P2_video.m3u8')
        ? MOTION_MEDIA
        : null;
    return body === null
      ? undefined
      : { success: true as const, status: 200, headers: {}, body, responseType: 'text' as const };
  });
  // 数光晕的小画布被画了几次
  await page.evaluate(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    Reflect.set(window, '__glowDraws', 0);
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'drawImage', {
      configurable: true,
      value(this: CanvasRenderingContext2D, ...args: unknown[]) {
        if (this.canvas.hasAttribute('data-cover-glow-frame'))
          Reflect.set(window, '__glowDraws', Number(Reflect.get(window, '__glowDraws')) + 1);
        return Reflect.apply(draw, this, args);
      },
    });
  });
  const draws = () => page.evaluate(() => Number(Reflect.get(window, '__glowDraws')));
  // 只有宽幅动态艺术照时头部按宽幅画；静帧在外框的背景层，视频叠在它上面
  await expect(env.view.locator('[data-artist-header]')).toHaveAttribute('data-shape', 'wide');
  const video = env.view.locator('[data-detail-backdrop] [data-artist-hero-video]');
  await expect(video).toHaveAttribute('data-ready', 'true');
  await expect(video).toHaveAttribute('src', `${MOTION_DIR}/P2_video-.mp4`);
  // 光晕跟着头图出，视频能放了就取它的画面
  const frame = env.view.locator('[data-cover-glow-frame]');
  await expect(frame).toHaveAttribute('data-ready', 'true');
  const drawn = await draws();
  expect(drawn).toBeGreaterThan(0);
  // 视频接着放，光晕跟着取样：画的次数随播放增加
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLVideoElement>('[data-artist-hero-video]')?.currentTime,
      ),
    )
    .toBeGreaterThan(0.5);
  await expect.poll(draws).toBeGreaterThan(drawn);
  // 往下滚、视频暂停之后光晕还在，停在最后取到的那一帧，不再画
  await page.evaluate(() => {
    document.querySelector<HTMLVideoElement>('[data-artist-hero-video]')?.pause();
  });
  await expect(frame).toHaveAttribute('data-ready', 'true');
  // 断言「不会再画」：暂停那一刻可能还有一个在途的新画面回调，先让它落地，再等过几个视频帧的时间数一次
  // （取样跟着视频的新画面走，没有别的信号可等，用真实时间）
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
  const paused = await draws();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(await draws()).toBe(paused);
  expect(env.errors).toEqual([]);
});

const LOGO_ROUTE = `${APPLE_LOGO}/**`;

test('艺术字图片：深色方案载入后取代文字名（文字名仍在 DOM、读屏不再读）', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route(LOGO_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }),
  );
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const env = await start(page, { Nujabes: [FIRST] }, [FIRST]);
  const header = env.view.locator('[data-artist-header]');
  const logo = header.locator('[data-artist-logo]');
  await expect(logo).toHaveAttribute('data-artist-logo', 'shown');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('alt', 'Nujabes');
  const name = header.getByRole('heading', { name: 'Nujabes', includeHidden: true });
  await expect(name).toHaveCount(1);
  await expect(name.locator('..')).toHaveAttribute('aria-hidden', 'true');
  // 取图地址：按原图 2930×958 的比例取 800 宽的 png
  expect(requested).toContain(`${APPLE_LOGO}/800x262bb.png`);
  expect(env.errors).toEqual([]);
});

test('艺术字图片：浅色方案不画图（图是纯白），仍画文字名', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const env = await start(page, { Nujabes: [FIRST] }, [FIRST]);
  await expect(
    env.view.locator('[data-artist-header]').getByRole('heading', { name: 'Nujabes' }),
  ).toBeVisible();
  await expect(env.view.locator('[data-artist-logo]')).toHaveCount(0);
});

test('艺术字图片：载入失败时留着文字名，不露空', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route(LOGO_ROUTE, (route) => route.abort());
  const env = await start(page, { Nujabes: [FIRST] }, [FIRST]);
  const header = env.view.locator('[data-artist-header]');
  await expect(header.locator('[data-artist-logo="loading"]')).toBeHidden();
  await expect(header.getByRole('heading', { name: 'Nujabes' })).toBeVisible();
});

test('墙上图块：本地没有 artist 图时，打开过的艺人改用缓存里的 Apple 艺术照，墙上不为它发 Apple 请求；来源换成 Last.fm 后退回专辑封面', async ({
  page,
}) => {
  // 墙上的图由页面直接向 Apple 的图片服务器取，这里截下来答同一张
  await page.route('https://*.mzstatic.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') }),
  );
  // 缓存文件留在替身里，重新载入后读得回来
  const files = new Map<string, string>();
  const env = await start(page, { Nujabes: [FIRST] }, [FIRST], (host) => {
    host.answer('artwork.getFb2kUrlByPath', (params) => {
      const found = params['type'] !== 'artist';
      return {
        success: true,
        available: found,
        type: String(params['type']),
        path: String(params['path']),
        dataUrl: found ? `data:image/png;base64,${PNG}` : '',
      };
    });
    host.answer('file.write', (params) => {
      files.set(String(params['path']), String(params['content']));
      return { success: true, bytesWritten: String(params['content']).length };
    });
    host.answer('file.read', (params) => {
      const content = files.get(String(params['path']));
      return content === undefined
        ? hostFailure('NOT_FOUND')
        : { success: true, content, size: content.length };
    });
  });
  await expect(env.about.getByText(FIRST.bio)).toBeVisible();
  const art = (name: string) => env.artist(name).locator('img');
  const appleCalls = () =>
    env.host
      .callsTo('http.get')
      .filter((call) => /itunes\.apple\.com|music\.apple\.com/.test(String(call['url']))).length;
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.wall).toBeVisible();
  const before = appleCalls();
  await expect(art('Nujabes')).toHaveAttribute('src', `${APPLE_THUMB}/600x600bb.jpg`);
  // 没打开过的没有缓存，仍是专辑封面
  await expect(art('Shing02')).toHaveAttribute('src', /^data:/);
  expect(appleCalls()).toBe(before);

  const wall = async () => {
    await page.reload();
    await page
      .getByRole('navigation', { name: '侧边栏' })
      .getByRole('button', { name: '艺人', exact: true })
      .click();
    await expect(env.wall).toBeVisible();
  };
  // 重新载入后从缓存文件读回，墙上照样用它
  await wall();
  await expect(art('Nujabes')).toHaveAttribute('src', `${APPLE_THUMB}/600x600bb.jpg`);
  // 来源换成 Last.fm：图要向 Apple 取，就不再用
  selectLastfmSource(env.host);
  await wall();
  await expect(art('Nujabes')).toHaveAttribute('src', /^data:/);
  expect(env.errors).toEqual([]);
});

/** Apple 页面里没有简介的 Nujabes */
const BARE: Entry = { ...FIRST, bio: '' };
const LASTFM_BIO = 'Nujabes 的 Last.fm 正文。';

/**
 * Last.fm 补全要的另外两家：MusicBrainz 上只有一位 Nujabes，发行组里有本地那两张，自动认定；
 * Last.fm 的 +wiki 页按 `lastfm` 答，给 null 时答 503
 */
function fallbackHosts(lastfm: () => string | null) {
  return (url: URL): Reply | undefined => {
    if (url.hostname === 'musicbrainz.org') {
      if (url.pathname === '/ws/2/artist')
        return apiReply(searchSample(candidateSample(NUJABES, 'Nujabes')));
      if (url.pathname === '/ws/2/release-group')
        return apiReply(releaseGroupsSample('Modal Soul', 'Metaphorical Music'));
      return apiReply(artistSample(NUJABES));
    }
    if (url.hostname === 'www.last.fm') {
      const html = lastfm();
      return html === null ? apiReply({}, 503) : { ...apiReply(null), body: html };
    }
    return undefined;
  };
}

/**
 * 补全要等一串请求：Apple 的英文页与默认页（页面之间隔 3 秒）、MusicBrainz 三次（每秒最多 1 次）、
 * Last.fm 一次，超过断言缺省的 5 秒
 */
const CHAIN_TIMEOUT = 15_000;

const withFallback = (on: boolean) => (host: PageHost) => {
  host.config.set(BIOGRAPHY_SOURCE_KEY, {
    version: 1,
    source: 'apple',
    identities: [],
    lastfmFallback: on,
  });
};

test('Apple 没有简介时改用 Last.fm：开关关着照旧没有简介、不问 Last.fm；打开后换上 Last.fm 的正文与来源行，「不是该艺人」停用这位', async ({
  page,
}) => {
  const html = biographyHtml('Nujabes', `<p>${LASTFM_BIO}</p>`, 'en');
  const env = await start(
    page,
    { Nujabes: [BARE] },
    [BARE],
    withFallback(false),
    fallbackHosts(() => html),
  );
  await expect(env.about.getByText('未找到可用简介')).toBeVisible();
  const asked = () =>
    env.host
      .callsTo('http.get')
      .filter((call) => /musicbrainz\.org|last\.fm/.test(String(call['url']))).length;
  expect(asked()).toBe(0);

  withFallback(true)(env.host);
  await page.reload();
  await page
    .getByRole('navigation', { name: '侧边栏' })
    .getByRole('button', { name: '艺人', exact: true })
    .click();
  await env.artist('Nujabes').click();
  await expect(env.about.getByText(LASTFM_BIO)).toBeVisible({ timeout: CHAIN_TIMEOUT });
  const sources = env.about.locator('[data-biography-sources]');
  await expect(sources).toContainText('Last.fm · 用户撰写');
  // 曲风行仍是 Apple 页面里的（Last.fm 的那一行叫「标签」）
  await expect(env.about).toContainText('曲风');
  await expect(env.about).not.toContainText('标签');

  await sources.getByRole('button', { name: '不是该艺人' }).click();
  await expect(env.about.getByText('未找到可用简介')).toBeVisible();
  await expect(env.about.getByText(LASTFM_BIO)).toHaveCount(0);
  await expect
    .poll(() => env.host.config.get(BIOGRAPHY_SOURCE_KEY))
    .toMatchObject({ lastfmFallback: true, lastfmDeclined: ['Nujabes'] });
  expect(env.errors).toEqual([]);
});

test('Last.fm 补全取失败：写明 Apple 没有简介、Last.fm 读取失败，重试只重取 Last.fm', async ({
  page,
}) => {
  let html: string | null = null;
  const env = await start(
    page,
    { Nujabes: [BARE] },
    [BARE],
    withFallback(true),
    fallbackHosts(() => html),
  );
  const status = env.about.locator('[role="status"]').first();
  await expect(status).toContainText('Last.fm 简介读取失败', { timeout: CHAIN_TIMEOUT });
  await expect(status).toContainText('未找到可用简介');
  const applePages = () =>
    env.host.callsTo('http.get').filter((call) => String(call['url']).includes('music.apple.com'))
      .length;
  const before = applePages();
  html = biographyHtml('Nujabes', `<p>${LASTFM_BIO}</p>`, 'en');
  await status.getByRole('button', { name: '重试' }).click();
  await expect(env.about.getByText(LASTFM_BIO)).toBeVisible();
  expect(applePages()).toBe(before);
  expect(env.errors).toEqual([]);
});
