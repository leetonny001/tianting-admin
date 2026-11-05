import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  clockNow,
  freshOtp,
  imUsers,
  login,
  provision,
  REASON,
  setClocks,
  setIMFaults,
  uid,
  watchPage,
} from './helpers';
import { dialIM } from './ws';

// FE-424：页面 → console-server → 真实 im-server（AC-ADM-50-1、50-3、50-5、50-8）。

const XSS = '<img src=x onerror=alert(1)>';

const hasText = (text: string) => (data: unknown) => (data as { text?: string }).text === text;

async function fillContent(page: Page, title: string, text: string) {
  await page.getByLabel('模板').selectOption('notice');
  await page.getByLabel('标题').fill(title);
  await page.getByLabel('正文').fill(text);
  await page.getByLabel('理由').fill(REASON);
}

/** 记下所有请求的 URL：通知内容不能进 URL。浏览器也不碰 im-server 和它的密钥。 */
function watchUrls(page: Page) {
  const urls: string[] = [];
  page.on('request', (r) => {
    urls.push(r.url());
    const names = Object.keys(r.headers()).join(' ').toLowerCase();
    expect(names).not.toContain('x-admin-key');
    expect(names).not.toContain('x-im-');
    expect(new URL(r.url()).pathname.startsWith('/admin/')).toBe(false);
  });
  page.on('response', (r) => {
    expect(Object.keys(r.headers()).join(' ').toLowerCase()).not.toContain('x-im-');
  });
  return urls;
}

test('按用户发送：预览后两人 3 秒内收到，XSS 只是文本（AC-ADM-50-1）', async ({ page }) => {
  const problems = watchPage(page);
  const urls = watchUrls(page);
  const u1 = uid('pa');
  const u2 = uid('pb');
  await imUsers([{ userId: u1 }, { userId: u2 }]);
  const c1 = await dialIM(u1, 'web');
  const c2 = await dialIM(u2, 'web');
  const op = await provision('op', 'operator');
  await login(page, op);
  await page.getByRole('link', { name: '发系统通知' }).click();
  await page.getByRole('textbox', { name: 'userId' }).fill(`${u1}\n${u2}`);
  const text = `正文 ${XSS} ${uid('t')}`;
  await fillContent(page, '维护公告', text);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '预览' }).click();
  await expect(page.getByText('2 人')).toBeVisible();
  await expect(page.getByTestId('push-preview-data')).toContainText(XSS);
  await expect(page.getByTestId('push-preview-data').locator('img')).toHaveCount(0);
  const start = Date.now();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('已发送，目标 2 人。')).toBeVisible();
  for (const c of [c1, c2]) {
    const f = await c.waitPush(hasText(text));
    expect(f.type).toBe('notice');
    expect(f.target).toBe('user');
    expect(f.data).toEqual({ title: '维护公告', text });
  }
  expect(Date.now() - start).toBeLessThan(3000);
  for (const u of urls) expect(u).not.toContain('维护公告');
  expect(urls.join('\n')).not.toContain(encodeURIComponent('维护公告'));
  expect(problems).toEqual([]);
  c1.close();
  c2.close();
});

test('CSV 目标、ghost 整批不发、模板校验提示', async ({ page }) => {
  const u = uid('pc');
  await imUsers([{ userId: u }]);
  const conn = await dialIM(u, 'web');
  const op = await provision('op', 'operator');
  await login(page, op);
  await page.goto('/push/new');
  const dir = mkdtempSync(join(tmpdir(), 'tt-push-'));
  const file = join(dir, 'targets.csv');
  writeFileSync(file, `userId\n${u}\n`);
  await page.getByLabel('上传 CSV（表头 userId）').setInputFiles(file);
  await expect(page.getByText('文件校验通过，1 人。')).toBeVisible();
  const text = uid('csv');
  await fillContent(page, 'CSV', text);
  await page.getByRole('button', { name: '预览' }).click();
  await expect(page.getByText('1 人', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await conn.waitPush(hasText(text));

  // 必填没填：字段提示，不发请求。
  await page.getByLabel('模板').selectOption('notice');
  await page.getByLabel('标题').fill('');
  await page.getByRole('textbox', { name: 'userId' }).fill(u);
  await page.getByLabel('正文').fill('x');
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('button', { name: '预览' }).click();
  await expect(page.getByText('必填')).toBeVisible();

  // ghost：列出来，整批不发。
  const ghost = uid('ghost');
  await page.getByRole('textbox', { name: 'userId' }).fill(`${u} ${ghost}`);
  const g = uid('g');
  await fillContent(page, 'Ghost', g);
  await page.getByRole('button', { name: '预览' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(`这些用户不存在，整批未发送：${ghost}`);
  await page.waitForTimeout(200);
  expect(conn.pushes.some((p) => hasText(g)(p.data))).toBe(false);
  conn.close();
});

test('结果未知：显示系统通知的文案，不让再点（imDropResponse）', async ({ page }) => {
  const u = uid('pd');
  await imUsers([{ userId: u }]);
  const conn = await dialIM(u, 'web');
  const op = await provision('op', 'operator');
  await login(page, op);
  await page.goto('/push/new');
  await page.getByRole('textbox', { name: 'userId' }).fill(u);
  const text = uid('drop');
  await fillContent(page, 'Drop', text);
  await page.getByRole('button', { name: '预览' }).click();
  await setIMFaults({ imDropResponse: true });
  try {
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('结果未知，系统会自动确认，请稍后查看发送记录');
  } finally {
    await setIMFaults({});
  }
  await expect(page.getByRole('button', { name: '发送', exact: true })).toHaveCount(0);
  await conn.waitPush(hasText(text)); // im-server 已经处理
  conn.close();
});

test('全员：草稿、自批按钮隐藏、批准后 5 人收到、离线收不到；T+4 提示，T+5 成功；审计员看全文（AC-ADM-50-3、50-5、50-8）', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchPage(page);
  const ids = Array.from({ length: 5 }, () => uid('on'));
  const off = uid('off');
  await imUsers([...ids, off].map((userId) => ({ userId })));
  const conns = await Promise.all(ids.map((id) => dialIM(id, 'web')));
  const op = await provision('op', 'operator');
  const both = await provision('ob', 'operator', 'super_admin');
  const adm1 = await provision('ad', 'super_admin');
  const adm2 = await provision('ad', 'super_admin');
  const auditor = await provision('au', 'auditor');
  const first = `全员 ${XSS} ${uid('a')}`;
  const second = uid('b');

  const makeDraft = async (text: string) => {
    await page.goto('/push/new');
    await page.getByLabel('发送范围').selectOption('all');
    await fillContent(page, '全员公告', text);
    await page.getByRole('button', { name: '预览' }).click();
    await expect(page.getByText('全员（当前在线的用户）')).toBeVisible();
    await page.getByRole('button', { name: '提交全员草稿' }).click();
    await expect(page.getByText(/草稿已提交/)).toBeVisible();
  };

  // 发起人同时是超管：自己的草稿没有批准按钮（服务端的 403 另有测试）。
  await login(page, both);
  const own = uid('own');
  await makeDraft(own);
  await page.goto('/push/drafts');
  await expect(page.getByRole('row').filter({ hasText: own })).toContainText(both.username);
  await expect(page.getByRole('row').filter({ hasText: own }).getByRole('button', { name: '批准' })).toHaveCount(0);
  await page.context().clearCookies();

  await login(page, op);
  await makeDraft(first);
  await makeDraft(second);
  await page.goto('/push/drafts');
  await expect(page.getByRole('button', { name: '批准' })).toHaveCount(0); // 运营不能批准
  await page.context().clearCookies();

  const row = (text: string) => page.getByRole('row').filter({ hasText: text });
  const approve = async (text: string) => {
    await row(text).getByRole('button', { name: '批准' }).click();
    await page.getByLabel('请输入 全员发送 确认').fill('全员发送');
    await page.getByRole('dialog').getByRole('button', { name: '批准并发送' }).click();
  };
  await login(page, adm1);
  await page.goto('/push/drafts');
  await expect(row(first).locator('img')).toHaveCount(0);
  await approve(first);
  const otp1 = page.getByRole('textbox', { name: '动态码' });
  await otp1.fill(await freshOtp(adm1.seed));
  await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '验证' }).click();
  const start = Date.now();
  await expect(page.getByText('已批准并发送。')).toBeVisible();
  const t0 = clockNow();
  for (const c of conns) {
    const f = await c.waitPush(hasText(first));
    expect(f.target).toBe('all');
  }
  expect(Date.now() - start).toBeLessThan(3000);
  const late = await dialIM(off, 'web');
  await page.waitForTimeout(300);
  expect(late.pushes).toEqual([]);
  late.close();
  await page.context().clearCookies();

  // AC-ADM-50-5：另一位超管在 T+4 分钟批准，提示间隔；T+5 分钟成功。freshOtp 会把钟推进 31 秒。
  await login(page, adm2);
  await page.goto('/push/drafts');
  await setClocks(t0 + 4 * 60_000 - 31_000);
  await approve(second);
  await page.getByRole('textbox', { name: '动态码' }).fill(await freshOtp(adm2.seed));
  await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '验证' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('全员通知间隔不少于 5 分钟');
  await setClocks(t0 + 5 * 60_000);
  await page.getByRole('dialog').getByRole('button', { name: '批准并发送' }).click();
  await expect(page.getByText('已批准并发送。')).toBeVisible();
  await conns[0]!.waitPush(hasText(second));
  await page.context().clearCookies();

  // AC-ADM-50-8：审计员看发送记录全文、发送人、批准人。
  await login(page, auditor);
  await page.getByRole('link', { name: '通知发送记录' }).click();
  const rec = row(first);
  await expect(rec).toContainText(XSS);
  await expect(rec.locator('img')).toHaveCount(0);
  await expect(rec).toContainText(op.username);
  await expect(rec).toContainText(adm1.username);
  await expect(rec).toContainText('已发送');
  await page.context().clearCookies();

  // 运营：菜单没有发送记录，直接打开显示无权限。
  await login(page, op);
  await expect(page.getByRole('link', { name: '通知发送记录' })).toHaveCount(0);
  await page.goto('/push/records');
  await expect(page.getByText('无权限')).toBeVisible();
  for (const c of conns) c.close();
  expect(problems).toEqual([]);
});
