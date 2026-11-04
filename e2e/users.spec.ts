import { expect, test } from '@playwright/test';
import { imUsers, login, provision, REASON, uid, watchPage } from './helpers';
import { dialIM } from './ws';

const XSS = '<img src=x onerror=alert(1)>';

test('搜索、空白不发请求、没有结果（AC-ADM-10-1、10-5）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const p = uid('s');
  await imUsers([{ userId: `${p}u100` }, { userId: `${p}u101` }, { userId: `${p}u2` }]);
  await login(page, kf);
  await page.goto('/users');
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/console/api/users')) requests++;
  });
  await page.getByLabel('搜索').fill('   ');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByText('请输入关键字')).toBeVisible();
  expect(requests).toBe(0);
  await page.getByLabel('搜索').fill(`${p}u10`);
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByRole('link', { name: `${p}u100` })).toBeVisible();
  await expect(page.getByRole('link', { name: `${p}u101` })).toBeVisible();
  await expect(page.getByRole('link', { name: `${p}u2` })).toHaveCount(0);
  await page.getByLabel('搜索').fill(`${p}nobody`);
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByText('没有找到用户')).toBeVisible();
});

test('XSS 和外部头像（AC-CON-10-2、10-5）', async ({ page }) => {
  const problems = watchPage(page);
  const kf = await provision('kf', 'support');
  const p = uid('x');
  await imUsers([{ userId: p, nickname: XSS, avatar: 'https://tracker.example/a.png' }]);
  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  const tracker: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('tracker.example') || /\/x$/.test(r.url())) tracker.push(r.url());
  });
  await login(page, kf);
  await page.goto(`/users?q=${p}`);
  await expect(page.getByRole('cell', { name: XSS })).toBeVisible();
  await page.getByRole('link', { name: p }).click();
  await expect(page.getByText(XSS)).toBeVisible();
  // 只有点了才显示 URL 文本，也不加载。
  await page.getByRole('button', { name: '查看原图地址' }).click();
  await expect(page.getByText('https://tracker.example/a.png')).toBeVisible();
  expect(await page.locator('img').count()).toBe(0);
  expect(tracker).toEqual([]);
  expect(dialogs).toBe(0);
  expect(problems).toEqual([]);
});

test('强制下线和在线设备（AC-ADM-12-1、12-3、14-1、14-5）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const u = uid('u');
  await imUsers([{ userId: u }]);
  const web = await dialIM(u, 'web');
  const pc = await dialIM(u, 'pc');
  await login(page, kf);
  await page.goto(`/users/${u}`);
  await expect(page.getByText('在线', { exact: true }).nth(1)).toBeVisible();

  // 在线设备：userId、理由都不进 URL。
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.getByRole('button', { name: '查看在线设备' }).click();
  const q = page.getByRole('dialog', { name: '查看在线设备' });
  await q.getByLabel('理由').fill('aaaa');
  await expect(q.getByRole('button', { name: '查询' })).toBeDisabled();
  await q.getByLabel('理由').fill(REASON);
  await q.getByRole('button', { name: '查询' }).click();
  await expect(page.getByRole('cell', { name: 'web', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'pc', exact: true })).toBeVisible();
  await expect(page.getByText(/只查了部分节点/)).toBeVisible();
  const queried = urls.filter((x) => x.includes('sessions/query'));
  expect(queried.length).toBe(1);
  expect(queried[0]).not.toContain(u);
  expect(queried[0]).not.toContain(encodeURIComponent(REASON));
  expect(page.url()).not.toContain(encodeURIComponent(REASON));

  await page.getByRole('button', { name: '强制下线' }).click();
  const k = page.getByRole('dialog', { name: '强制下线' });
  await expect(k).toContainText('2 个在线设备');
  await expect(k).toContainText('要阻止登录请使用封禁');
  await k.getByLabel('理由').fill(REASON);
  await k.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('status')).toHaveText('已强制下线');
  expect((await web.kicked()).reason).toBe('banned');
  expect((await pc.kicked()).reason).toBe('banned');
});

test('用户不存在（AC-ADM-12-3）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  await login(page, kf);
  await page.goto('/users/nobody-page');
  await expect(page.getByRole('alert')).toHaveText('用户不存在：nobody-page');
});

test('官方账号（AC-ADM-17-1、17-3）', async ({ page }) => {
  const op = await provision('op', 'operator');
  const u = uid('kefu');
  await imUsers([{ userId: u }]);
  await login(page, op);
  await page.goto(`/users/${u}`);
  await page.getByRole('button', { name: '设为官方账号' }).click();
  const d = page.getByRole('dialog', { name: '设为官方账号' });
  await expect(d).toContainText('用户仍可以拉黑它');
  await d.getByLabel('理由').fill(REASON);
  await d.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('button', { name: '取消官方账号' })).toBeVisible();
  await page.goto('/users?official=true');
  await expect(page.getByRole('link', { name: u })).toBeVisible();
});
