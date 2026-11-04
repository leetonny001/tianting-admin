import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { imGroup, imUsers, login, provision, REASON, setFault, uid, watchPage } from './helpers';

const XSS = '<img src=x onerror=alert(1)>';

test('审计页：筛选、32 天、详情、结果未知、XSS（AC-CON-09-1、08-1、08-9、10-2）', async ({ page, browser }) => {
  const problems = watchPage(page);
  const kf = await provision('kf', 'support');
  const aud = await provision('aud', 'auditor');
  const u = uid('u');
  const v = uid('v');
  await imUsers([{ userId: u }, { userId: v }]);

  // 客服强制下线两次：第二次注入 result 写失败。
  const kfCtx = await browser.newContext({ baseURL: 'http://127.0.0.1:18190' });
  const kfPage = await kfCtx.newPage();
  await login(kfPage, kf);
  const kick = async (id: string, reason: string) => {
    await kfPage.goto(`/users/${id}`);
    await kfPage.getByRole('button', { name: '强制下线' }).click();
    await kfPage.getByLabel('理由').fill(reason);
    await kfPage.getByRole('button', { name: '确认' }).click();
    await expect(kfPage.getByRole('status')).toHaveText('已强制下线');
  };
  await kick(u, `${REASON} ${XSS}`);
  await setFault('failResult');
  await kick(v, REASON);
  await setFault('ok');
  await kfCtx.close();

  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await login(page, aud);
  await page.goto('/audit');
  // 32 天不可查。
  const from = await page.getByLabel('开始时间').inputValue();
  const to = await page.getByLabel('结束时间').inputValue();
  await page
    .getByLabel('开始时间')
    .fill(new Date(new Date(to).getTime() - 32 * 86400000 + 8 * 3600000).toISOString().slice(0, 16));
  await expect(page.getByText('最长 31 天')).toBeVisible();
  await expect(page.getByRole('button', { name: '查询' })).toBeDisabled();
  await page.getByLabel('开始时间').fill(from);

  await page.getByLabel('操作人').fill(kf.username);
  await page.getByLabel('动作').selectOption('user.kick');
  await page.getByRole('button', { name: '查询' }).click();
  const rows = page.getByRole('row');
  // 第一次 intent + result，第二次只有 intent。
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole('cell', { name: `${REASON} ${XSS}` }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '结果未知' })).toHaveCount(1);
  const unknown = rows.filter({ hasText: '结果未知' });
  await expect(unknown).toContainText(v);

  // 只有 intent 的详情。
  await unknown.getByRole('button', { name: '详情' }).click();
  const dlg = page.getByRole('dialog', { name: '审计详情' });
  await expect(dlg).toContainText('结果未知：还没有结论');
  await dlg.getByRole('button', { name: '关闭' }).click();

  // intent / result 合并；im-server 侧记录。
  await rows.filter({ hasText: u }).first().getByRole('button', { name: '详情' }).click();
  const d2 = page.getByRole('dialog', { name: '审计详情' });
  await expect(d2.getByRole('heading', { name: /操作前/ })).toBeVisible();
  await expect(d2.getByRole('heading', { name: '结果', exact: true })).toBeVisible();
  await expect(d2.getByText(kf.username).first()).toBeVisible();
  await d2.getByRole('button', { name: '查看 im-server 侧记录' }).click();
  await expect(d2.getByRole('cell', { name: /force-logout/ }).first()).toBeVisible();
  expect(dialogs).toBe(0);
  expect(await page.locator('img').count()).toBe(0);
  expect(problems).toEqual([]);
});

test('通知中心：铃铛未读数，打开后清零（AC-CON-12-3）', async ({ page }) => {
  const aud = await provision('aud', 'auditor');
  // 新建敏感角色账号时通知审计员：造 3 条。
  for (let i = 0; i < 3; i++) await provision('mod', 'moderator');
  await login(page, aud);
  const bell = page.getByRole('link', { name: /通知，\d+ 条未读/ });
  await expect(bell).toHaveAccessibleName(/通知，[1-9]\d* 条未读/);
  await bell.click();
  await expect(page.getByRole('heading', { name: '通知中心' })).toBeVisible();
  await expect(page.getByText('授予了敏感角色').first()).toBeVisible();
  await expect(page.getByRole('link', { name: '通知，0 条未读' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: '通知，0 条未读' })).toBeVisible();
});

test('后台请求带 X-Console-Background，用户操作不带（FE-400 内容 4）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const seen: { url: string; bg?: string }[] = [];
  page.on('request', (r) => seen.push({ url: r.url(), bg: r.headers()['x-console-background'] }));
  await login(page, kf);
  await page.goto('/users?q=abc');
  await expect(page.getByText('没有找到用户')).toBeVisible();
  const unread = seen.filter((s) => s.url.includes('unread-count'));
  expect(unread.length).toBeGreaterThan(0);
  for (const s of unread) expect(s.bg).toBe('1');
  const search = seen.filter((s) => s.url.includes('/console/api/users?'));
  expect(search.length).toBeGreaterThan(0);
  for (const s of search) expect(s.bg).toBeUndefined();
});

test('不能被 iframe 嵌入（AC-CON-10-4）', async ({ page }) => {
  await page.goto('about:blank');
  await page.setContent(`<iframe id="f" src="http://127.0.0.1:18190/login"></iframe>`);
  await page.waitForTimeout(500);
  const frame = page.frames().find((f) => f.url().includes('/login'));
  const loaded = frame
    ? await frame
        .locator('#root')
        .count()
        .catch(() => 0)
    : 0;
  expect(loaded).toBe(0);
});

test('一次完整流程的 HAR 里没有 IM 密钥和签名头（AC-CON-10-1）', async ({ browser }, info) => {
  const har = info.outputPath('flow.har');
  const op = await provision('op', 'operator');
  const kf = await provision('kf', 'support');
  const u = uid('u');
  const g = uid('g');
  await imUsers([{ userId: u }]);
  await imGroup(g, '群', [u]);
  const ctx = await browser.newContext({
    baseURL: 'http://127.0.0.1:18190',
    recordHar: { path: har, content: 'embed' },
  });
  const page = await ctx.newPage();
  await login(page, kf);
  await page.goto(`/users?q=${u}`);
  await page.getByRole('link', { name: u }).click();
  await page.getByRole('button', { name: '强制下线' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('status')).toHaveText('已强制下线');
  await page.getByRole('button', { name: '退出' }).click();
  await login(page, op);
  await page.goto(`/groups/${g}`);
  await expect(page.getByRole('button', { name: '解散群' })).toBeVisible();
  await ctx.close();
  const text = readFileSync(har, 'utf8');
  expect(text.length).toBeGreaterThan(1000);
  const seed = Buffer.from('tianting-e2e-signing-seed-32byte');
  for (const bad of [
    'X-Admin-Key',
    'X-IM-Signature',
    'X-IM-Caller',
    'tianting-e2e-legacy-key',
    seed.toString(),
    seed.toString('base64'),
  ]) {
    expect(text).not.toContain(bad);
  }
});
