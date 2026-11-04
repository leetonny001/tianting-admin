import { expect, test } from '@playwright/test';
import {
  createPending,
  freshOtp,
  login,
  loginApi,
  PASSWORD,
  provision,
  REASON,
  imUsers,
  totp,
  tick,
  uid,
  watchPage,
} from './helpers';

test('激活 → 绑定 → 首页只有客服菜单（AC-CON-02-2）', async ({ page }) => {
  const problems = watchPage(page);
  const { username, code } = await createPending('kfnew', 'support');
  await page.goto('/activate');
  await page.getByLabel('账号').fill(username);
  await page.getByLabel('激活码').fill(code);
  await page.getByLabel('新密码').fill('short');
  await page.getByLabel('再输一次').fill('short');
  await page.getByRole('button', { name: '激活' }).click();
  await expect(page.getByRole('alert')).toContainText('密码太短');
  await page.getByLabel('新密码').fill(PASSWORD);
  await page.getByLabel('再输一次').fill(PASSWORD);
  await page.getByRole('button', { name: '激活' }).click();
  await expect(page.getByRole('img', { name: '二次验证二维码' })).toBeVisible();

  // setup 状态打开业务路由跳回绑定页（AC-CON-02-5）。
  await page.goto('/users');
  await expect(page).toHaveURL(/\/setup$/);
  const secret = await page.getByTestId('totp-secret').innerText();
  await tick();
  await page.getByLabel('动态码').fill(totp(secret));
  await page.getByRole('button', { name: '绑定' }).click();
  await expect(page.getByRole('list', { name: '恢复码' }).getByRole('listitem')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '完成' })).toBeDisabled();
  await page.getByLabel('我已保存').check();
  await page.getByRole('button', { name: '完成' }).click();
  const nav = page.getByRole('navigation', { name: '主菜单' });
  await expect(nav.getByRole('link', { name: '用户', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '消息元数据' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '账号管理' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '审计日志' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('Cookie 和本地存储（AC-CON-03-1、05-2）', async ({ page, context }) => {
  const a = await provision('kf', 'support');
  await login(page, a);
  const cookies = await context.cookies();
  const sid = cookies.find((c) => c.name === '__Host-adm_sid');
  expect(sid?.httpOnly).toBe(true);
  expect(sid?.secure).toBe(true);
  expect(sid?.sameSite).toBe('Strict');
  const seen = await page.evaluate(() => [
    document.cookie,
    JSON.stringify(localStorage),
    JSON.stringify(sessionStorage),
  ]);
  for (const s of seen) expect(s).not.toContain(sid!.value);
  expect(seen[0]).toBe('');
});

test('登录失败统一提示、恢复码只能用一次（AC-CON-03-6）', async ({ page }) => {
  const a = await provision('kf', 'support');
  await page.goto('/login');
  await page.getByLabel('账号').fill(a.username);
  await page.getByLabel('密码').fill('wrong-password-xx');
  await page.getByLabel('动态码').fill('000000');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('账号、密码或动态码错误');

  const recovery = async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: '手机不在身边？用恢复码' }).click();
    await page.getByLabel('账号').fill(a.username);
    await page.getByLabel('密码').fill(a.password);
    await page.getByLabel('恢复码').fill(a.recovery[0]!);
    await page.getByRole('button', { name: '登录', exact: true }).click();
  };
  await recovery();
  await expect(page.getByRole('navigation', { name: '主菜单' })).toBeVisible();
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await recovery();
  await expect(page.getByRole('alert')).toHaveText('账号、密码或动态码错误');
});

test('刷新后第一次写操作不出现 4037（AC-CON-05-10）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const u = uid('u');
  await imUsers([{ userId: u }]);
  await login(page, kf);
  await page.goto(`/users/${u}`);
  await page.reload();
  await page.getByRole('button', { name: '强制下线' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('status')).toHaveText('已强制下线');
});

test('被挤下线跳登录页并说明原因（AC-CON-05-12）', async ({ page }) => {
  const a = await provision('kf', 'support');
  await login(page, a);
  // 每个账号最多 3 个会话：再登录 3 次，最早的（页面这个）被挤掉。
  for (let i = 0; i < 3; i++) await loginApi(a);
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '用户', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=replaced/);
  await expect(page.getByRole('status')).toHaveText('你的账号在别处登录，本次登录已退出');
});

test('修改密码（FE-405）', async ({ page }) => {
  const a = await provision('kf', 'support');
  await login(page, a);
  await page.goto('/settings');
  await expect(page.getByText('还剩 10 个')).toBeVisible();
  await page.getByLabel('当前密码').fill(a.password);
  await page.getByLabel('动态码').fill(await freshOtp(a.seed));
  await page.getByLabel('新密码').fill('Another-Long-Passw0rd-1');
  await page.getByRole('button', { name: '修改' }).click();
  await expect(page.getByText('密码已修改')).toBeVisible();
  // 重新生成恢复码要 step-up。
  await page.getByRole('button', { name: '重新生成' }).click();
  await page.getByRole('button', { name: '确认' }).click();
  const dlg = page.getByRole('dialog', { name: '输入动态码确认' });
  await dlg.getByLabel('动态码').fill(await freshOtp(a.seed));
  await dlg.getByRole('button', { name: '验证' }).click();
  await expect(page.getByRole('list', { name: '恢复码' }).getByRole('listitem')).toHaveCount(10);
});
