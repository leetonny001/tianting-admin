import { expect, test } from '@playwright/test';
import { imGroup, imUsers, login, loginApi, provision, REASON, clockNow, uid, watchPage } from './helpers';
import { imTrySend } from './ws';

// FE-441（CS-063）：全群禁言、用户所在群、用户会话列表。连真实的 console-server 和 im-server。

const CONVS = '/console/api/users/convs/query';

test('群详情开启、关闭全员禁言（AC-ADM-42-3）', async ({ page }) => {
  const problems = watchPage(page);
  const kf = await provision('kf', 'support');
  const op = await provision('op', 'operator');
  const aud = await provision('au', 'auditor');
  const member = uid('gm');
  const g = uid('gg');
  await imUsers([{ userId: member }]);
  await imGroup(g, '全员禁言测试', [member]);
  await login(page, kf);
  await page.goto(`/groups/${g}`);
  await expect(page.getByText('未开启')).toBeVisible();

  // 不填理由不能提交。
  await page.getByRole('button', { name: '开启全员禁言' }).click();
  const dlg = page.getByRole('dialog', { name: '开启全员禁言' });
  await expect(dlg.getByRole('button', { name: '开启' })).toBeDisabled();
  await dlg.getByLabel('理由').fill(REASON);
  await dlg.getByRole('button', { name: '开启' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByText('全员禁言中')).toBeVisible();

  // 刷新后还在：状态来自 im-server。
  await page.reload();
  await expect(page.getByText('全员禁言中')).toBeVisible();
  expect(await imTrySend(member, 'group', g, 'x')).toBe(4031);

  // operator 没有 mute.write：页面没有按钮，接口 403。
  const opApi = await loginApi(op);
  await expect(
    opApi.call('POST', '/console/api/mutes', { scope: 'groupAll', groupId: g, reason: REASON }),
  ).rejects.toThrow(/403.*4030/);
  const opCtx = page.context();
  await opCtx.clearCookies();
  await login(page, op);
  await page.goto(`/groups/${g}`);
  await expect(page.getByText('全员禁言中')).toBeVisible();
  await expect(page.getByRole('button', { name: /全员禁言/ })).toHaveCount(0);

  await opCtx.clearCookies();
  await login(page, kf);
  await page.goto(`/groups/${g}`);
  await page.getByRole('button', { name: '关闭全员禁言' }).click();
  const off = page.getByRole('dialog', { name: '关闭全员禁言' });
  await off.getByLabel('理由').fill(REASON);
  await off.getByRole('button', { name: '关闭' }).click();
  await expect(off).toHaveCount(0);
  await expect(page.getByText('未开启')).toBeVisible();
  await expect(page.getByText('全员禁言中')).toHaveCount(0);
  expect(await imTrySend(member, 'group', g, 'y')).toBe(0);

  // 审计有操作人和理由。
  const audApi = await loginApi(aud);
  const now = clockNow();
  const rows = await audApi.call<{ records: { action: string; username: string; reason: string; phase: string }[] }>(
    'GET',
    `/console/api/audit?from=${now - 3600_000}&to=${now + 60_000}&action=mute.set`,
  );
  const mine = rows.records.filter(
    (r) => r.action === 'mute.set' && r.username === kf.username && r.phase === 'result',
  );
  expect(mine.length).toBe(1);
  expect(mine[0]!.reason).toBe(REASON);
  expect(problems.filter((p) => !/403/.test(p))).toEqual([]);
});

test('用户详情：所在群进群详情；会话列表要理由、没有正文、单聊再要理由（AC-ADM-30-9）', async ({ page }) => {
  const problems = watchPage(page);
  const MARK = 'ZXQ-USERCONV-MARK';
  const kf = await provision('kf', 'support');
  const op = await provision('op', 'operator');
  const u = uid('ua');
  const peer = uid('ub');
  const g = uid('ug');
  await imUsers([{ userId: u }, { userId: peer }]);
  await imGroup(g, '所在群测试', [u, peer]);
  expect(await imTrySend(u, 'group', g, MARK)).toBe(0);
  expect(await imTrySend(u, 'c2c', peer, MARK)).toBe(0);
  const conv = u < peer ? `c2c:${u}:${peer}` : `c2c:${peer}:${u}`;

  const convUrls: string[] = [];
  const convBodies: string[] = [];
  page.on('response', async (r) => {
    if (new URL(r.url()).pathname === CONVS) {
      convUrls.push(r.url());
      convBodies.push(await r.text());
    }
  });
  await login(page, kf);
  await page.goto(`/users/${u}`);

  // 所在群：不要理由，点击进群详情。
  await page.getByRole('link', { name: g }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${g}$`));
  await expect(page.getByRole('heading', { name: '所在群测试' })).toBeVisible();

  // 会话列表：先填理由。
  await page.goto(`/users/${u}`);
  expect(convUrls).toEqual([]);
  await page.getByRole('button', { name: '查看会话列表' }).click();
  const dlg = page.getByRole('dialog', { name: '查看会话列表' });
  await expect(dlg.getByRole('button', { name: '查询' })).toBeDisabled();
  expect(convUrls).toEqual([]);
  await dlg.getByLabel('理由').fill(REASON);
  await dlg.getByRole('button', { name: '查询' }).click();
  await expect(dlg).toHaveCount(0);
  const c2cRow = page.getByRole('row', { name: new RegExp(conv) });
  await expect(c2cRow).toContainText('单聊');
  await expect(page.getByRole('row', { name: new RegExp(`group:${g}`) })).toContainText('群聊');
  await expect(page.locator('body')).not.toContainText(MARK);
  expect(convUrls.length).toBe(1);
  expect(convUrls[0]).not.toContain(u);
  expect(convUrls[0]).not.toContain('reason');
  expect(convBodies[0]).not.toContain(MARK);
  expect(page.url()).not.toContain('reason');

  // 进群会话：元数据直接查。
  await page.getByRole('button', { name: `group:${g}` }).click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('heading', { name: '消息元数据' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toContainText(u);
  await expect(page.locator('body')).not.toContainText(MARK);

  // 进单聊：要理由（F-ADM-30 规则 3）。
  await page.goto(`/users/${u}`);
  await page.getByRole('button', { name: '查看会话列表' }).click();
  await dlg.getByLabel('理由').fill(REASON);
  await dlg.getByRole('button', { name: '查询' }).click();
  await page.getByRole('button', { name: conv }).click();
  const c2cDlg = page.getByRole('dialog', { name: '查询单聊元数据' });
  await expect(c2cDlg).toBeVisible();
  await c2cDlg.getByLabel('理由').fill(REASON);
  await c2cDlg.getByRole('button', { name: '查询' }).click();
  await expect(c2cDlg).toHaveCount(0);
  await expect(page.getByRole('row').nth(1)).toContainText(u);

  // operator：有所在群（group.read），没有会话列表入口；接口 403。
  await page.context().clearCookies();
  await login(page, op);
  await page.goto(`/users/${u}`);
  await expect(page.getByRole('link', { name: g })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看会话列表' })).toHaveCount(0);
  const opApi = await loginApi(op);
  await expect(opApi.call('POST', CONVS, { userId: u, reason: REASON })).rejects.toThrow(/403.*4030/);

  // 不填理由打开：400 / 4000。翻页和 15 分钟窗口的断言在 console-server 的 TestUserConvs_AC30_9 和组件测试里。
  const kfApi = await loginApi(kf);
  await expect(kfApi.call('POST', CONVS, { userId: u })).rejects.toThrow(/400.*4000/);
  expect(problems.filter((p) => !/40[03]/.test(p))).toEqual([]);
});
