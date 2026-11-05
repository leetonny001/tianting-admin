import { expect, test } from '@playwright/test';
import { clockNow, imUsers, login, provision, setClocks, uid, watchPage } from './helpers';
import { dialIM } from './ws';

// F-ADM-70（FE-440、CS-060）。连真实的 console-server 和 im-server。page.clock 只快进页面里的定时器，服务端的 [C 钟] 另外拨。

test('数据概览：3 个 web、2 个 pc 在线，标注单节点；60 秒刷新带后台头（AC-ADM-70-1）', async ({ page, context }) => {
  const problems = watchPage(page);
  const op = await provision('op', 'operator');
  const ids = [uid('st'), uid('st'), uid('st'), uid('st'), uid('st')];
  await imUsers(ids.map((userId) => ({ userId })));
  await page.clock.install();
  const seen: { bg?: string }[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/console/api/stats') seen.push({ bg: r.headers()['x-console-background'] });
  });
  await login(page, op);
  const card = page.getByRole('region', { name: '在线连接数' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('只统计接收请求的节点，不是集群总数');
  // 别的用例可能还留着连接：以打开时的数字为基准。
  const base = Number(await card.locator('.card-big').innerText());

  const conns = await Promise.all([
    dialIM(ids[0]!, 'web'),
    dialIM(ids[1]!, 'web'),
    dialIM(ids[2]!, 'web'),
    dialIM(ids[3]!, 'pc'),
    dialIM(ids[4]!, 'pc'),
  ]);
  try {
    const before = seen.length;
    const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === '/console/api/stats');
    await page.clock.fastForward(60_000);
    expect((await refreshed).status()).toBe(200);
    await expect(card.locator('.card-big')).toHaveText(String(base + 5));
    await expect(card).toContainText(/pc \d+、web \d+/);
    expect(seen.length).toBeGreaterThan(before);
    expect(seen[0]!.bg).toBeUndefined(); // 打开页面是用户操作
    for (const s of seen.slice(before)) expect(s.bg).toBe('1');
    await expect(page.getByRole('region', { name: '今日新增用户' }).locator('.card-big')).toHaveText(/^[\d,]+$/);
    await expect(page.getByRole('region', { name: '今日消息数' })).toContainText('不含群提示消息');
    await expect(page.getByRole('region', { name: '群总数' })).toContainText('不含已解散的群');
  } finally {
    for (const c of conns) c.close();
  }
  expect(problems).toEqual([]);
  await context.clearCookies();
});

test('首页开着没人操作：31 分钟后刷新 401 / 4014，跳登录页（AC-ADM-70-2）', async ({ page }) => {
  const op = await provision('op', 'operator');
  await page.clock.install();
  // 铃铛每 30 秒也有一次后台轮询，会先收到 4014。这里要看的是概览自己的刷新，所以把铃铛挡在外面。
  await page.route('**/console/api/notifications/unread-count', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"unread":0}' }),
  );
  await login(page, op);
  await page.goto('/');
  await expect(page.getByRole('region', { name: '在线连接数' })).toBeVisible();

  // 29 分钟时的后台刷新成功，但不续期。
  await setClocks(clockNow() + 29 * 60_000);
  const ok = page.waitForResponse((r) => new URL(r.url()).pathname === '/console/api/stats');
  await page.clock.fastForward(60_000);
  const first = await ok;
  expect(first.status()).toBe(200);
  expect(first.request().headers()['x-console-background']).toBe('1');

  // 再过 2 分钟（一共 31 分钟）：如果上面续期了，这里还能成功。
  await setClocks(clockNow() + 2 * 60_000);
  const expired = page.waitForResponse((r) => new URL(r.url()).pathname === '/console/api/stats');
  await page.clock.fastForward(60_000);
  const r = await expired;
  expect(r.request().headers()['x-console-background']).toBe('1');
  expect(r.status()).toBe(401);
  expect(((await r.json()) as { code: number }).code).toBe(4014);
  await expect(page).toHaveURL(/\/login\?reason=idle$/);
});

test('只有超管和运营有概览；客服、审计员不发请求（F-ADM-05 矩阵）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const requests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/console/api/stats') requests.push(r.url());
  });
  await login(page, kf);
  await expect(page.getByRole('heading', { name: /你好/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '数据概览' })).toHaveCount(0);
  expect(requests).toEqual([]);
});
