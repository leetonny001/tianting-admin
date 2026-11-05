import { expect, test } from '@playwright/test';
import { freshOtp, imGroup, imUsers, login, provision, REASON, tick, uid, watchPage } from './helpers';
import { dialIM, imSend } from './ws';

// 第二批（FE-420 ～ FE-423）：页面 → console-server → 真实 im-server。

test('封禁按钮按权限显示；封禁踢线、解封（AC-ADM-13-1、13-5、13-9）', async ({ page }) => {
  const problems = watchPage(page);
  const u = uid('bn');
  await imUsers([{ userId: u }]);
  const kf = await provision('kf', 'support');
  await login(page, kf);
  await page.goto(`/users/${u}`);
  await expect(page.getByRole('button', { name: '强制下线' })).toBeVisible();
  await expect(page.getByRole('button', { name: '封禁', exact: true })).toHaveCount(0);

  await page.context().clearCookies();
  const mod = await provision('md', 'moderator');
  await login(page, mod);
  const conn = await dialIM(u, 'web');
  await page.goto(`/users/${u}`);
  await page.getByRole('button', { name: '封禁', exact: true }).click();
  await page.getByLabel('时长').selectOption('1d');
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '封禁' }).click();
  // 没有 step-up：弹动态码框，通过后自动重放。
  await page.getByRole('textbox', { name: '动态码' }).fill(await freshOtp(mod.seed));
  await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '验证' }).click();
  expect((await conn.kicked()).reason).toBe('suspended');
  await expect(page.getByText('已封禁')).toBeVisible();
  await page.goto(`/users?q=${u}`);
  await expect(page.getByText('已封禁')).toBeVisible();
  await page.goto(`/users/${u}`);
  await page.getByRole('button', { name: '解封' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '解封' }).click();
  await expect(page.getByText('已封禁')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('用户和群成员禁言、解除（AC-ADM-40-4、41-4）', async ({ page }) => {
  const u = uid('mu');
  const g = uid('mg');
  await imUsers([{ userId: u }]);
  await imGroup(g, 'n', [u]);
  const kf = await provision('kf', 'support');
  await login(page, kf);
  const conn = await dialIM(u, 'web');
  await page.goto(`/users/${u}`);
  await page.getByRole('button', { name: '禁言', exact: true }).click();
  await page.getByLabel('时长').selectOption('custom');
  await page.getByLabel('自定义时长（分钟）').fill('0');
  await expect(page.getByText('时长需要在 1 分钟到 30 天之间')).toBeVisible();
  await page.getByLabel('自定义时长（分钟）').fill('5');
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '禁言' }).click();
  await conn.waitEvent('muted');
  await expect(page.getByText('禁言中')).toBeVisible();
  await page.getByRole('button', { name: '解除禁言' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '解除' }).click();
  await conn.waitEvent('unmuted');
  await expect(page.getByText('禁言中')).toHaveCount(0);

  await page.goto(`/groups/${g}`);
  const row = page.getByRole('row', { name: new RegExp(u) });
  await row.getByRole('button', { name: '群内禁言' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '禁言' }).click();
  await expect(row.getByText('禁言中')).toBeVisible();
  await row.getByRole('button', { name: '解除' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '解除' }).click();
  await expect(row.getByText('禁言中')).toHaveCount(0);
});

test('正文查看：弹框、水印、过期再弹框、删除、隔离原文（AC-ADM-08-3、08-4、08-5、08-10、31-1、32-2）', async ({
  page,
}) => {
  const problems = watchPage(page);
  const u = uid('cu');
  const g = uid('cg');
  await imUsers([{ userId: u }]);
  await imGroup(g, 'n', [u]);
  await imSend(u, g, 2); // 正文是 ZXQ-BODY-123
  const mod = await provision('md', 'moderator');
  await login(page, mod);
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${g}`);
  await page.getByRole('button', { name: '查询' }).click();
  await page.getByRole('button', { name: '查看正文' }).click();

  const grant = async () => {
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('工单号').fill('T-100');
    await page.getByLabel('理由').fill(REASON);
    await page.getByLabel('动态码').fill(await freshOtp(mod.seed));
    await page.getByRole('dialog').getByRole('button', { name: '查看' }).click();
  };
  // 错误的动态码：留在框内，显示原因。
  await page.getByLabel('工单号').fill('T-100');
  await page.getByLabel('理由').fill(REASON);
  await page.getByLabel('动态码').fill('000000');
  await page.getByRole('dialog').getByRole('button', { name: '查看' }).click();
  await expect(page.getByRole('dialog').getByText('账号、密码或动态码错误')).toBeVisible();
  await grant();
  await expect(page.getByText('ZXQ-BODY-123').first()).toBeVisible();
  // AC-ADM-08-10：覆盖整个消息区域的水印，文本含账号名、时间、授权前 8 位；没有导出、复制按钮。
  const wm = page.getByTestId('watermark');
  await expect(wm.locator('span').first()).toHaveText(
    new RegExp(`^${mod.username} \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} [0-9a-f]{8}$`),
  );
  const area = await page.locator('.body-area').boundingBox();
  const mark = await wm.boundingBox();
  expect(mark!.width).toBeGreaterThanOrEqual(area!.width - 1);
  expect(mark!.height).toBeGreaterThanOrEqual(area!.height - 1);
  await expect(page.getByRole('button', { name: /导出|复制/ })).toHaveCount(0);
  expect(await page.locator('.body-area').evaluate((e) => getComputedStyle(e).userSelect)).toBe('none');

  // AC-ADM-08-4、08-5：两边时钟推进 16 分钟，授权过期：弹同一个框，不跳登录页。
  await tick(16 * 60_000);
  await page.reload();
  await expect(page.getByLabel('工单号')).toBeVisible();
  expect(page.url()).not.toContain('/login');
  await grant();
  await expect(page.getByText('ZXQ-BODY-123').first()).toBeVisible();

  // 删除一条。
  const conn = await dialIM(u, 'web');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /删除所选/ }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
  await page.getByRole('textbox', { name: '动态码' }).fill(await freshOtp(mod.seed));
  await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '验证' }).click();
  await conn.waitEvent('msgDeleted');
  await expect(page.getByText(/该消息已被删除/)).toBeVisible();

  // 元数据页显示删除标记；隔离原文能看到原文。
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${g}`);
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByText(/已删除/)).toBeVisible();
  await page.getByRole('button', { name: '查看隔离原文' }).click();
  await grant();
  await expect(page.getByRole('heading', { level: 1, name: /隔离原文/ })).toBeVisible();
  await expect(page.getByText('ZXQ-BODY-123')).toHaveCount(1);
  await expect(page.getByTestId('watermark')).toBeAttached();
  expect(problems).toEqual([]);
});

test('单聊正文未开启（AC-ADM-08-7）', async ({ page }) => {
  const mod = await provision('md', 'moderator');
  await login(page, mod);
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill('c2c:a:b');
  await page.getByRole('button', { name: '查询' }).click();
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('dialog').getByRole('button', { name: '查询' }).click();
  await page.getByRole('button', { name: '查看正文' }).click();
  await page.getByLabel('工单号').fill('T-100');
  await page.getByLabel('理由').fill(REASON);
  await page.getByLabel('动态码').fill(await freshOtp(mod.seed));
  await page.getByRole('dialog').getByRole('button', { name: '查看' }).click();
  await expect(page.getByRole('dialog').getByText('单聊正文查看未开启')).toBeVisible();
});
