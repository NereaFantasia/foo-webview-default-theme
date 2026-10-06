import { expect, test, type Locator } from '@playwright/test';
import { openFolders } from '../fixtures/foldersPage.ts';
import { FOLDER_TRACKS } from '../fixtures/foldersLibrary.ts';

test.use({ screenshot: 'off' });

const fold = (tree: Locator) => tree.locator('[data-folder-fold-ghost]');

/** 平移值里最后一个像素数，即纵向位移；`none` 为 0。 */
function lastPixels(value: string): number {
  return Number(/(-?[\d.]+)px\s*$/.exec(value)?.[1] ?? 0);
}

/** 下一个出现的目录树折叠副本停在第 0 帧，好量它的起始位置。 */
async function pauseNextFold(tree: Locator) {
  await tree.evaluate((element) => {
    const observer = new MutationObserver(() => {
      const frame = element.querySelector('[data-folder-fold-ghost]');
      if (!frame) return;
      observer.disconnect();
      for (const animation of frame.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 0;
      }
    });
    observer.observe(element, { childList: true, subtree: true });
  });
}

/** 量副本框、父行与真实行；`follower` 是父目录下方第一个目录的名字。 */
async function foldSnapshot(tree: Locator, head: string, follower: string) {
  return tree.evaluate(
    (element, [headName, followerName]) => {
      const pixels = (node: Element | undefined) =>
        node ? Number(/(-?[\d.]+)px\s*$/.exec(getComputedStyle(node).translate)?.[1] ?? 0) : 0;
      const frame = element.querySelector<HTMLElement>('[data-folder-fold-ghost]');
      const headRow = [...element.querySelectorAll<HTMLElement>('[data-folder-row]')].find((row) =>
        row.textContent?.includes(headName ?? ''),
      );
      if (!frame || !headRow) throw new Error('缺少折叠副本或父行');
      const [body, below] = [...frame.children];
      const followerCopy = [...(below?.children ?? [])].find((row) =>
        row.textContent?.includes(followerName ?? ''),
      );
      return {
        inert: frame.inert,
        hidden: frame.getAttribute('aria-hidden'),
        frameTop: frame.getBoundingClientRect().top,
        headTop: headRow.getBoundingClientRect().top,
        headBottom: headRow.getBoundingClientRect().bottom,
        body: body?.textContent ?? '',
        bodyShift: pixels(body),
        followerTop: followerCopy?.getBoundingClientRect().top ?? Number.NaN,
        durations: frame
          .getAnimations({ subtree: true })
          .map((animation) => animation.effect?.getTiming().duration),
        hiddenRows: [...element.querySelectorAll<HTMLElement>('[data-folder-row]')]
          .filter((row) => getComputedStyle(row).visibility === 'hidden')
          .map((row) => row.textContent ?? ''),
      };
    },
    [head, follower],
  );
}

async function finishFold(tree: Locator) {
  await fold(tree).evaluate(async (frame) => {
    const animations = frame.getAnimations({ subtree: true });
    for (const animation of animations) animation.finish();
    await Promise.all(animations.map((animation) => animation.finished));
  });
  await expect(fold(tree)).toHaveCount(0);
}

test('同页目录后退交还各自的筛选与树焦点，树 DOM 保持原对象', async ({ page }) => {
  const env = await openFolders(page, (host) => {
    host.answer('library.search', (params) => {
      const tracks = FOLDER_TRACKS.filter((track) =>
        String(params.query).toLowerCase().includes(track.title.toLowerCase()),
      );
      return {
        success: true,
        tracks,
        total: tracks.length,
        offset: 0,
        limit: 1000,
        hasMore: false,
      };
    });
  });
  await env.folder('Alpha').click();
  await env.view.getByRole('combobox', { name: '筛选此目录中的曲目' }).fill('Amber');
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await expect(env.grid.getByText('Zebra', { exact: true })).toHaveCount(0);
  const tree = await env.tree.elementHandle();
  await env.folder('Beta').click();
  await env.view.getByRole('combobox', { name: '筛选此目录中的曲目' }).fill('Blue');
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.view.getByRole('combobox', { name: '筛选此目录中的曲目' })).toHaveValue('Amber');
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await expect(env.folder('Alpha')).toHaveAttribute('data-focused', 'true');
  expect(await env.tree.evaluate((element, original) => element === original, tree)).toBe(true);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(env.view.getByRole('combobox', { name: '筛选此目录中的曲目' })).toHaveValue('Blue');
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('目录双击仍按该目录起播', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').dblclick();
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual(FOLDER_TRACKS.slice(0, 2).map((track) => track.path));
  expect(env.errors).toEqual([]);
});

test('键入定位后重复点击当前目录，回车使用点击的焦点', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await env.tree.press('b');
  await expect(env.folder('Beta')).toHaveAttribute('data-focused', 'true');
  await env.folder('Alpha').click();
  await env.tree.press('Enter');
  await expect
    .poll(() => env.host.callsTo('library.addToPlaylist').at(-1)?.paths)
    .toEqual(FOLDER_TRACKS.slice(0, 2).map((track) => track.path));
  await expect(env.folder('Alpha')).toHaveAttribute('data-focused', 'true');
  expect(env.errors).toEqual([]);
});

test('后退到隐藏的预览目录，保留快照中的祖先收起状态', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await env.folder('Disc').click();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.folder('Alpha').getByRole('button', { name: '折叠目录', exact: true }).click();
  await expect(env.folder('Disc')).toHaveCount(0);
  await env.folder('Beta').click();
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(env.view.getByRole('heading', { name: 'Disc', exact: true })).toBeVisible();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await expect(env.folder('Alpha')).toHaveAttribute('aria-expanded', 'false');
  await expect(env.folder('Disc')).toHaveCount(0);
  await expect(env.folder('Alpha')).toHaveAttribute('data-focused', 'true');
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(env.folder('Disc')).toHaveAttribute('aria-selected', 'true');
  expect(env.errors).toEqual([]);
});

test('收起后的隐藏选区仍参与 Ctrl 加选的合并预览', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await env.folder('Disc').click();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.folder('Alpha').getByRole('button', { name: '折叠目录', exact: true }).click();
  await expect(env.folder('Disc')).toHaveCount(0);
  await env.folder('Beta').click({ modifiers: ['Control'] });
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await expect(env.view.getByRole('heading', { name: '已选 2 个目录', exact: true })).toBeVisible();
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(env.folder('Disc')).toHaveAttribute('aria-selected', 'true');
  await expect(env.folder('Beta')).toHaveAttribute('aria-selected', 'true');
  expect(env.errors).toEqual([]);
});

test('侧键与键盘共享目录历史，路径访问也可返回', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await env.folder('Beta').click();
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await env.view.dispatchEvent('mouseup', { button: 3, bubbles: true });
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  await env.view
    .getByRole('navigation', { name: '目录路径' })
    .getByRole('button', { name: 'Music', exact: true })
    .click();
  await expect(env.grid.getByText('Zebra', { exact: true })).toBeVisible();
  await env.view.dispatchEvent('mouseup', { button: 3, bubbles: true });
  await expect(env.grid.getByText('Blue', { exact: true })).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('统一树菜单递归展开与收起，关闭动画后直接到终态', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const env = await openFolders(page);
  await env.folder('Music').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '展开全部子目录', exact: true }).click();
  await expect(env.folder('Disc')).toBeVisible();
  await env.folder('Music').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '折叠全部子目录', exact: true }).click();
  await expect(env.tree.getByRole('treeitem')).toHaveCount(1);
  await env.folder('Music').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(env.folder('Alpha')).toHaveAttribute('aria-expanded', 'false');
  await expect(env.folder('Disc')).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('首次展开等子目录读回再播，父行不动，子目录从父行下沿的固定框里滑出', async ({ page }) => {
  const env = await openFolders(page);
  const held = env.host.hold('library.browseTree');
  const head = await env.folder('Alpha').boundingBox();
  const beta = await env.folder('Beta').boundingBox();
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect.poll(() => held.pending.length).toBeGreaterThan(0);
  await expect(fold(env.tree)).toHaveCount(0);
  await pauseNextFold(env.tree);
  held.release();
  await expect(fold(env.tree)).toHaveCount(1);
  const shot = await foldSnapshot(env.tree, 'Alpha', 'Beta');
  expect(shot.headTop).toBeCloseTo(head?.y ?? Number.NaN, 0);
  expect(shot.frameTop).toBeCloseTo(shot.headBottom, 0);
  expect(shot.durations).toEqual([333, 333]);
  expect(shot.body).toContain('Disc');
  expect(shot.bodyShift).toBeCloseTo(-40, 0);
  expect(shot.followerTop).toBeCloseTo(beta?.y ?? Number.NaN, 0);
  expect(shot.hiddenRows.some((text) => text.includes('Disc'))).toBe(true);
  expect(shot.hiddenRows.some((text) => text.includes('Beta'))).toBe(true);
  await finishFold(env.tree);
  await expect(env.folder('Disc')).toBeVisible();
  const after = await env.folder('Beta').boundingBox();
  expect(after?.y).toBeCloseTo((beta?.y ?? Number.NaN) + 40, 0);
  expect(env.errors).toEqual([]);
});

test('树收起由父行下沿的框裁剪，副本滑回，完成后移除且保留隐藏的选择', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(env.folder('Disc')).toBeVisible();
  await expect(fold(env.tree)).toHaveCount(0);
  await env.folder('Disc').click();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await pauseNextFold(env.tree);
  await env.folder('Alpha').getByRole('button', { name: '折叠目录', exact: true }).click();
  await expect(fold(env.tree)).toHaveCount(1);
  const shot = await foldSnapshot(env.tree, 'Alpha', 'Beta');
  expect(shot.inert).toBe(true);
  expect(shot.hidden).toBe('true');
  expect(shot.frameTop).toBeCloseTo(shot.headBottom, 0);
  expect(shot.durations).toEqual([167, 167]);
  expect(shot.body).toContain('Disc');
  expect(shot.bodyShift).toBeCloseTo(0, 0);
  expect(shot.followerTop).toBeCloseTo(shot.headBottom + 40, 0);
  expect(shot.hiddenRows.some((text) => text.includes('Beta'))).toBe(true);
  await expect(env.folder('Disc')).toHaveCount(0);
  await finishFold(env.tree);
  await expect(env.folder('Beta')).toBeVisible();
  await expect(env.grid.getByText('Amber', { exact: true })).toBeVisible();
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(env.folder('Disc')).toHaveAttribute('aria-selected', 'true');
  await expect(fold(env.tree)).toHaveCount(0);
  expect(env.errors).toEqual([]);
});

test('树开合中途反向从当前位置接续，不另起第二个副本', async ({ page }) => {
  const env = await openFolders(page);
  await env.folder('Alpha').getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(env.folder('Disc')).toBeVisible();
  await expect(fold(env.tree)).toHaveCount(0);
  await pauseNextFold(env.tree);
  await env.folder('Alpha').getByRole('button', { name: '折叠目录', exact: true }).click();
  await expect(fold(env.tree)).toHaveCount(1);
  const reversed = await env.tree.evaluate(async (tree) => {
    const frame = tree.querySelector<HTMLElement>('[data-folder-fold-ghost]');
    const toggle = [...tree.querySelectorAll<HTMLElement>('[data-folder-row]')]
      .find((row) => row.textContent?.includes('Alpha'))
      ?.querySelector('button');
    const body = frame?.firstElementChild;
    if (!frame || !toggle || !body) throw new Error('缺少折叠副本或父目录的开合键');
    for (const animation of frame.getAnimations({ subtree: true })) animation.currentTime = 83;
    const paused = getComputedStyle(body).translate;
    toggle.click();
    await new Promise(requestAnimationFrame);
    const [moving] = body.getAnimations();
    const first =
      moving?.effect instanceof KeyframeEffect ? moving.effect.getKeyframes()[0] : undefined;
    return {
      frames: tree.querySelectorAll('[data-folder-fold-ghost]').length,
      same: tree.querySelector('[data-folder-fold-ghost]') === frame,
      paused,
      start: String(first?.translate ?? ''),
      duration: Number(moving?.effect?.getTiming().duration ?? 0),
    };
  });
  expect(reversed.frames).toBe(1);
  expect(reversed.same).toBe(true);
  expect(lastPixels(reversed.start)).toBeCloseTo(lastPixels(reversed.paused), 0);
  expect(lastPixels(reversed.paused)).toBeLessThan(0);
  expect(reversed.duration).toBeGreaterThan(0);
  expect(reversed.duration).toBeLessThan(333);
  await expect(fold(env.tree)).toHaveCount(0);
  await expect(env.folder('Disc')).toBeVisible();
  expect(env.errors).toEqual([]);
});

test('选中曲目的回收站确认使用固定文件对象，取消不执行，确认后显示实际结果', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const env = await openFolders(page, (host) => {
    host.answer('file.getInfo', { success: true, exists: true, isFile: true, isDirectory: false });
    host.answer('file.delete', { success: true });
  });
  await env.folder('Alpha').click();
  const row = env.grid.getByRole('row').filter({ hasText: 'Zebra' });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移入回收站…', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(FOLDER_TRACKS[0]!.absolutePath, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(env.host.callsTo('file.delete')).toEqual([]);
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移入回收站…', exact: true }).click();
  await dialog.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(dialog.getByText('已移入回收站', { exact: true })).toBeVisible();
  expect(env.host.callsTo('file.delete')).toEqual([
    { path: FOLDER_TRACKS[0]!.absolutePath, moveToTrash: true },
  ]);
  await dialog.getByRole('button', { name: '关闭提示', exact: true }).click();
  await env.folder('Alpha').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '移入回收站…', exact: true })).toHaveCount(0);
  expect(env.errors).toEqual([]);
});
