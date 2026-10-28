import { expect, test, type Page } from '@playwright/test';
import { collectPageErrors } from '../fixtures/pageHost.ts';
import { onlineLog, openOnlineHarness } from '../fixtures/onlinePage.ts';

// 设置里「在线音乐」一组在试验页里配音乐客户端替身跑：账号卡的扫码登录、退出与组件没下载时的引导，解灰卡的读取中与失败，
// 其他平台卡的组件下载与音源管理。

test.use({ screenshot: 'off' });

const account = (page: Page) =>
  page.locator('[data-settings-expander]').filter({ hasText: '网易云账号' });
const unblock = (page: Page) =>
  page.locator('[data-settings-card]').filter({ hasText: '用第三方来源补全无法播放的曲目' });
const platforms = (page: Page) =>
  page.locator('[data-settings-expander]').filter({ hasText: '其他平台' });
const source = (page: Page, name: string) =>
  platforms(page).locator('[data-settings-row]').filter({ hasText: name });
const kinds = async (page: Page) =>
  (await onlineLog(page)).map((entry) =>
    typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'kind') : null,
  );

test('点「登录」才取二维码，收起后照样能登上；退出登录要确认，退出后不自己取二维码', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { view: 'settings' });
  const card = account(page);
  // 没登录时卡头只有「登录」键，不另写「未登录」。
  await expect(card.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(card).not.toContainText('未登录');
  await expect(card.getByRole('img', { name: '登录二维码' })).toHaveCount(0);
  expect(await kinds(page)).not.toContain('login-start');

  await card.getByRole('button', { name: '登录', exact: true }).click();
  await expect(card.getByRole('img', { name: '登录二维码' })).toBeVisible();
  await card.locator('[data-settings-toggle]').click();
  await expect(card.getByRole('img', { name: '登录二维码' })).toHaveCount(0);
  await expect(card).toContainText('已登录：Tester', { timeout: 10_000 });
  expect((await kinds(page)).filter((kind) => kind === 'login-check')).toHaveLength(2);

  await card.getByRole('button', { name: '退出登录', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '退出网易云账号？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(card).toContainText('已登录：Tester');
  expect(await kinds(page)).not.toContain('logout');

  await card.getByRole('button', { name: '退出登录', exact: true }).click();
  await dialog.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(card).not.toContainText('已登录');
  await expect(card.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect((await kinds(page)).filter((kind) => kind === 'login-start')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('组件没下载时不取二维码，就地下载，装好后能登录', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { view: 'settings', ncm: 'missing' });
  const card = account(page);
  await expect(card).toContainText('下载即表示同意组件所含的许可：ISC, MIT');
  await expect(card.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);
  expect(await kinds(page)).not.toContain('login-start');
  // 后端没登记 lxserver 组件，其他平台卡不出。
  await expect(platforms(page)).toHaveCount(0);
  await card.getByRole('button', { name: '下载', exact: true }).click();
  await expect(card.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});

test('解灰：读到之前不画开关', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { view: 'settings', status: 'pending' });
  await expect(unblock(page).getByRole('progressbar', { name: '正在读取…' })).toBeVisible();
  await expect(unblock(page).getByRole('switch')).toHaveCount(0);
});

test('解灰：修改失败时风险说明与失败一起显示，开关照后端的值', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { view: 'settings', unblock: 'fail' });
  const toggle = unblock(page).getByRole('switch');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(unblock(page)).toContainText('没能修改这项设置');
  await expect(unblock(page)).toContainText('曲目 ID 会发送给第三方服务');
  await expect(toggle).not.toBeChecked();
});

test('其他平台：组件没下载时写体积、来源与许可，下载装好后列出音源', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { view: 'settings', lx: 'missing' });
  const card = platforms(page);
  await expect(card).toContainText('从 CNB 下载');
  await expect(card).toContainText('Apache-2.0');
  await card.getByRole('button', { name: '下载', exact: true }).click();
  await expect(source(page, '星海音乐源')).toBeVisible();
  await expect(card).toContainText('已启用 1 份音源');
  expect(await kinds(page)).toContain('lx-install');
});

test('其他平台：列出版本、作者与平台，加载失败的写明；启停、调整先后与移除', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, { view: 'settings', lx: 'hosted' });
  const card = platforms(page);
  await expect(source(page, '星海音乐源')).toContainText('v3.2.15');
  await expect(source(page, '星海音乐源')).toContainText('万去了了');
  for (const name of ['QQ 音乐', '酷我', '酷狗', '咪咕'])
    await expect(
      source(page, '星海音乐源').getByRole('img', { name: `${name}：未检测` }),
    ).toBeVisible();
  await expect(source(page, 'old.js')).toContainText('脚本加载失败：SyntaxError: Unexpected token');
  await expect(
    source(page, '星海音乐源').getByRole('button', { name: '提高 星海音乐源 的优先级' }),
  ).toBeDisabled();

  await source(page, 'old.js').getByRole('switch').click();
  await expect(source(page, 'old.js').getByRole('switch')).toBeChecked();
  await expect(card).toContainText('已启用 2 份音源');

  await source(page, 'old.js').getByRole('button', { name: '提高 old.js 的优先级' }).click();
  await expect(card.locator('[data-settings-row]').nth(1)).toContainText('old.js');

  await source(page, 'old.js').getByRole('button', { name: 'old.js 的更多操作' }).click();
  await page.getByRole('menuitem', { name: '移除' }).click();
  await expect(source(page, 'old.js')).toHaveCount(0);
  expect(await kinds(page)).toEqual(expect.arrayContaining(['lx-toggle', 'lx-order', 'lx-remove']));
  expect(errors).toEqual([]);
});

test('其他平台：从文件与网址导入；lxserver 不收时写原因，网址不对时在对话框里拦下', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await openOnlineHarness(page, { view: 'settings', lx: 'hosted' });
  const card = platforms(page);
  const importFrom = async (item: string) => {
    await card.getByRole('button', { name: '导入脚本…' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  host.answer('dialog.openFile', {
    success: true,
    canceled: false,
    filePaths: ['C:\\lx\\新音源.js'],
  });
  host.answer('file.read', { success: true, content: '/*! 新音源 */', size: 16 });
  await importFrom('从文件…');
  await expect(source(page, '新音源.js')).toContainText('酷狗');

  host.answer('file.read', { success: true, content: 'REJECT', size: 6 });
  await importFrom('从文件…');
  await expect(card).toContainText('lxserver 没有收下这份脚本');

  await importFrom('从网址…');
  const dialog = page.getByRole('dialog', { name: '从网址导入音源脚本' });
  await dialog.getByRole('textbox', { name: '脚本网址' }).fill('ftp://example.test/a.js');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog).toContainText('网址要以 http:// 或 https:// 开头');
  await dialog.getByRole('textbox', { name: '脚本网址' }).fill('https://example.test/net.js');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(source(page, 'net.js')).toBeVisible();
});

const HOSTED = { view: 'settings', lx: 'hosted' } as const;
const checkAll = (page: Page) =>
  platforms(page).getByRole('button', { name: /^(全部检测|检测中…)$/ });
const platformItem = (page: Page, name: string) =>
  source(page, '星海音乐源').getByRole('img', { name });
/** 悬停平台项，核对悬浮提示的全文，再移开等提示收起，免得下一次悬停时同时有两个提示 */
async function expectTip(page: Page, item: string, text: string) {
  await platformItem(page, item).hover();
  await expect(page.getByRole('tooltip')).toHaveText(text);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}
const checks = async (page: Page) =>
  (await onlineLog(page)).filter(
    (entry) =>
      typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === 'lx-check',
  );

test('其他平台：全部检测——结果写在各平台项上，悬停给出细节，载入失败的不检测', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectPageErrors(page);
  await openOnlineHarness(page, HOSTED);
  await expect(source(page, '星海音乐源')).not.toContainText('上次检测');
  await checkAll(page).click();
  await expect(platformItem(page, '酷我：可用')).toBeVisible();
  await expect(source(page, '星海音乐源')).toContainText('上次检测 刚刚');
  await expect(platformItem(page, '酷狗：地址打不开')).toBeVisible();
  await expect(platformItem(page, '咪咕：没有给出播放地址')).toBeVisible();
  await expect(platformItem(page, 'QQ 音乐：没能检测')).toBeVisible();
  await expect(checkAll(page)).toHaveText('全部检测');
  // 四个平台各检测一次；停用且载入失败的 old.js 不检测
  expect(await checks(page)).toHaveLength(4);

  await expectTip(page, '酷我：可用', '可用 · 215 毫秒 · 刚刚');
  await expectTip(page, '酷狗：地址打不开', '地址打不开 · HTTP 404 · 刚刚');
  await expectTip(page, '咪咕：没有给出播放地址', '没有给出播放地址 · 咪咕找不到 · 刚刚');
  await expectTip(page, 'QQ 音乐：没能检测', '没有可检测的曲目');
  expect(errors).toEqual([]);
});

test('其他平台：检测中按钮与平台项都显示检测中；这份音源的「检测」在检测期间不可用', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, lxcheck: 'hold' });
  await checkAll(page).click();
  await expect(checkAll(page)).toHaveText('检测中…');
  await expect(checkAll(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(platformItem(page, '酷我：检测中')).toBeVisible();
  await expect(platformItem(page, 'QQ 音乐：检测中')).toBeVisible();
  await source(page, '星海音乐源').getByRole('button', { name: '星海音乐源 的更多操作' }).click();
  await expect(page.getByRole('menuitem', { name: '检测', exact: true })).toBeDisabled();
  // 一次最多发两项，其余排队
  await expect.poll(async () => (await checks(page)).length).toBe(2);
});

test('其他平台：音源行的「检测」只检测这一份；载入失败的音源不能检测', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, HOSTED);
  await source(page, '星海音乐源').getByRole('button', { name: '星海音乐源 的更多操作' }).click();
  await page.getByRole('menuitem', { name: '检测', exact: true }).click();
  await expect(platformItem(page, '酷我：可用')).toBeVisible();
  expect(await checks(page)).toHaveLength(4);
  await page.keyboard.press('Escape');
  await source(page, 'old.js').getByRole('button', { name: 'old.js 的更多操作' }).click();
  await expect(page.getByRole('menuitem', { name: '检测', exact: true })).toBeDisabled();
});

test('其他平台：检测请求没答上时卡头写没有完成，平台项照检测前的样子', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, lxcheck: 'fail' });
  await checkAll(page).click();
  await expect(platforms(page)).toContainText('检测没有完成');
  await expect(platformItem(page, '酷我：未检测')).toBeVisible();
  await expect(checkAll(page)).toHaveText('全部检测');
  await expect(source(page, '星海音乐源')).not.toContainText('上次检测');
});

test('其他平台：后端记着的结果一打开就显示；停用的音源不显示状态；载入失败的原因可看全文', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOnlineHarness(page, { ...HOSTED, lxsources: 'checked' });
  await expect(platformItem(page, '酷我：可用')).toBeVisible();
  await expect(platformItem(page, '酷狗：地址打不开')).toBeVisible();
  await expect(platformItem(page, '咪咕：未检测')).toBeVisible();
  const ago = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(-10, 'minute');
  await expectTip(page, '酷我：可用', `可用 · 215 毫秒 · ${ago}`);
  await expect(source(page, '星海音乐源')).toContainText(`上次检测 ${ago}`);

  // 说明行最多两行，全文在 title 里；读屏播报的是另一处
  await expect(
    source(page, 'old.js').getByTitle('脚本加载失败：SyntaxError: Unexpected token'),
  ).toBeVisible();

  // 停用后只列平台名，旧结果不显示
  await source(page, '星海音乐源').getByRole('switch').click();
  await expect(source(page, '星海音乐源').getByRole('img', { name: /：/ })).toHaveCount(0);
  await expect(source(page, '星海音乐源')).toContainText('QQ 音乐、酷我、酷狗、咪咕');
  await expect(source(page, '星海音乐源')).not.toContainText('上次检测');
  await expect(checkAll(page)).toBeDisabled();
});
