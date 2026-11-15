import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlaceId } from '../../src/nav/places.ts';
import { PLAYER_BAR_STYLES } from '../../src/theme/playerBarStyle.ts';
import { libraryAnswers, SAMPLE_ALBUMS } from '../fixtures/albumLibrary.ts';
import { openArtists } from '../fixtures/artistsPage.ts';
import { openFolders } from '../fixtures/foldersPage.ts';
import { openGenres } from '../fixtures/genresPage.ts';
import { openHome } from '../fixtures/homePage.ts';
import { collectPageErrors, installPageHost } from '../fixtures/pageHost.ts';
import { openPlayer, routeHarness, switchPreference } from '../fixtures/playerPage.ts';
import { openPlaylist } from '../fixtures/playlistPage.ts';
import { openSearchBox } from '../fixtures/searchBox.ts';
import { openSettings } from '../fixtures/settingsPage.ts';
import { openSongs } from '../fixtures/songsPage.ts';
import { openVideo } from '../fixtures/videoPage.ts';

// 地点冒烟：地点表里的每个地点，在播放栏的三种形态下都渲染得出来、没有报错。播放栏形态改的是外壳的排法
// （导航行、底部让位、页面用的 CSS 变量），页面自己的用例多半只在缺省形态下跑，形态相关的坏法没人看
// 登记表按 `PlaceId` 逐个登记：地点表里新加一个地点，这里不登记就过不了类型检查；
// 每个地点只开一次页面，再经试验入口在页面上换形态，不重开

/** 一张页面的一个面：同一个地点有几种样子（艺人的封面墙与详情页）时登记多个 */
interface Face {
  readonly name: string;
  /** 页面的根；断言它画出来了、没溢出窗口 */
  readonly root: (page: Page) => Locator;
  /** 打开到这个面，等到它画完 */
  readonly open: (page: Page) => Promise<void>;
  /** 页面不在外壳的内容卡里（沉浸视图盖住整个窗口），不核对导航行 */
  readonly outsideCard?: true;
}

/**
 * 一个地点的登记：
 * - 面的列表：能打开，三种形态下都核对
 * - `disabledEntry`：页面还没做，侧边栏里的入口（按钮名）是禁用的，用户进不去；入口一启用就要换成面的列表
 * - `skip`：现在没法在带外壳的页面里打开，写明原因
 */
type Entry = readonly Face[] | { readonly disabledEntry: string } | { readonly skip: string };

const view = (id: string) => (page: Page) => page.locator(`[data-page="${id}"]`).last();

/** 缺省落地的是专辑页：装上专辑库，等第一批专辑画出来 */
async function openAlbums(page: Page): Promise<void> {
  await installPageHost(page, { answers: libraryAnswers(SAMPLE_ALBUMS) });
  await page.goto('/');
  await expect(
    page.locator('[data-album-tile], [data-album-list] [role="row"]').first(),
  ).toBeVisible();
}

const SMOKE: Record<PlaceId, Entry> = {
  home: [{ name: '首页', root: view('home'), open: async (page) => void (await openHome(page)) }],
  favorites: [
    {
      name: '收藏',
      root: view('favorites'),
      // 主窗里没有后端，收藏读不到：页面照常出，内容区写读取失败
      open: async (page) => {
        await openAlbums(page);
        const entry = page
          .getByRole('navigation', { name: '侧边栏' })
          .getByRole('button', { name: '收藏', exact: true });
        if (!(await entry.isVisible()))
          await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
        await entry.click();
        await expect(view('favorites')(page)).toBeVisible();
      },
    },
  ],
  albums: [{ name: '专辑墙', root: view('albums'), open: openAlbums }],
  album: [
    {
      name: '专辑详情',
      root: view('album'),
      open: async (page) => {
        await openAlbums(page);
        await page.locator('[data-album-tile]').filter({ hasText: 'The Wall' }).click();
        await page.locator('[data-dropdown-detail]').click();
        await expect(view('album')(page).locator('h1')).toHaveText('The Wall');
      },
    },
  ],
  songs: [
    { name: '歌曲表', root: view('songs'), open: async (page) => void (await openSongs(page)) },
  ],
  artists: [
    {
      name: '艺人墙',
      root: view('artists'),
      open: async (page) => void (await openArtists(page)),
    },
    {
      name: '艺人详情',
      root: view('artists'),
      open: async (page) => {
        const env = await openArtists(page);
        await env.artist('Nujabes').click();
        await expect(env.view.locator('[data-artist-header]')).toBeVisible();
      },
    },
  ],
  genres: [
    { name: '流派', root: view('genres'), open: async (page) => void (await openGenres(page)) },
  ],
  folders: [
    { name: '文件夹', root: view('folders'), open: async (page) => void (await openFolders(page)) },
  ],
  playlist: [
    {
      name: '播放列表',
      root: view('playlist'),
      open: async (page) => void (await openPlaylist(page, 'Mix')),
    },
  ],
  search: [
    {
      name: '搜索结果',
      root: view('search'),
      open: async (page) => {
        const { input } = await openSearchBox(page);
        await input.fill('Nujabes');
        await input.press('Enter');
        await expect(view('search')(page)).toBeVisible();
      },
    },
  ],
  settings: [
    { name: '设置', root: view('settings'), open: async (page) => void (await openSettings(page)) },
  ],
  channel: [
    {
      name: '频道',
      root: view('channel'),
      open: async (page) => {
        const home = await openHome(page);
        await home.view.getByRole('button', { name: '新建频道', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('名称', { exact: false }).fill('夜间收藏');
        await dialog.locator('[data-query-scope]').click();
        await page.locator('[data-query-mode="advanced"]').click();
        await dialog.getByRole('searchbox', { name: '查询', exact: true }).fill('ALL');
        await dialog.getByRole('button', { name: '保存', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await home.view.getByRole('button', { name: '夜间收藏', exact: true }).click();
        await expect(page.locator('[data-page="channel"]').getByRole('treegrid')).toBeVisible();
      },
    },
  ],
  video: [
    {
      name: '视频页',
      root: (page) => page.getByRole('region', { name: '视频', exact: true }),
      open: async (page) => void (await openVideo(page)),
    },
  ],
  nowPlaying: [
    {
      name: '沉浸视图',
      outsideCard: true,
      root: (page) => page.getByRole('region', { name: '正在播放' }),
      open: async (page) => {
        await openPlayer(page);
        await page.locator('[data-player-bar] [data-player-key="cover"]').click();
        await expect(page.getByRole('region', { name: '正在播放' })).toBeVisible();
      },
    },
  ],
  recent: { disabledEntry: '最近添加' },
  playlists: { disabledEntry: '所有播放列表' },
  onlineList: {
    skip: '要在线音乐客户端的替身，现有的在线用例在不带外壳的试验页里跑，没有播放栏形态可换',
  },
  onlineAlbums: {
    skip: '同 onlineList',
  },
};

for (const [id, entry] of Object.entries(SMOKE)) {
  if ('skip' in entry) {
    test.skip(`${id}：${entry.skip}`, () => {});
    continue;
  }
  if ('disabledEntry' in entry) {
    const label = entry.disabledEntry;
    test(`${id}：页面还没做，侧边栏的「${label}」是禁用项；入口启用后要补登记`, async ({
      page,
    }) => {
      await openAlbums(page);
      // 缺省宽度下侧边栏是展开的；先等它画出来再找入口，不写「没看到就展开」的分支，那条在负载高时会抢跑
      const sidebar = page.getByRole('navigation', { name: '侧边栏' });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
    continue;
  }
  for (const face of entry) {
    test(`${id}（${face.name}）：播放栏三种形态下都渲染得出来、没有报错`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await routeHarness(page);
      await face.open(page);
      const viewport = page.viewportSize();
      for (const form of PLAYER_BAR_STYLES) {
        await switchPreference(page, 'player-bar', form);
        // 先确认形态真的换上了：带导航行的只有标题栏形态，页面在 `.card[data-with-nav-row]` 里
        if (!face.outsideCard)
          await expect(page.locator('[data-with-nav-row]'), form).toHaveCount(
            form === 'titlebar' ? 1 : 0,
          );
        const root = face.root(page);
        await expect(root, form).toBeVisible();
        const box = await root.boundingBox();
        expect(box?.width ?? 0, `${form}：页面根有宽度`).toBeGreaterThan(100);
        expect(box?.height ?? 0, `${form}：页面根有高度`).toBeGreaterThan(50);
        if (viewport)
          expect(
            (box?.x ?? 0) + (box?.width ?? 0),
            `${form}：页面根没有溢出窗口右缘`,
          ).toBeLessThanOrEqual(viewport.width + 1);
      }
      expect(errors).toEqual([]);
    });
  }
}
