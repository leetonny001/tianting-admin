import { expect, test } from '@playwright/test';
import { clockNow, imAccountPost, imGroup, imUsers, login, loginApi, provision, uid } from './helpers';

// 人工看样式用：SHOTS=目录 npx playwright test e2e/zz-screenshots.spec.ts
test.skip(!process.env.SHOTS, 'SHOTS=dir 才截图');
test('screens', async ({ page }) => {
  const dir = process.env.SHOTS!;
  const op = await provision('yunying', 'operator', 'support');
  const p = uid('demo');
  await imUsers([
    { userId: `${p}01`, nickname: '小明' },
    { userId: `${p}02`, nickname: 'Tom' },
    { userId: `${p}03`, nickname: '客服小助手' },
  ]);
  await imGroup(`${p}-g`, '春季活动群', [`${p}01`, `${p}02`, `${p}03`]);
  await page.goto('/login');
  await page.screenshot({ path: `${dir}/login.png` });
  await login(page, op);
  await page.goto(`/users?q=${p}`);
  await expect(page.getByRole('link', { name: `${p}01` })).toBeVisible();
  await page.screenshot({ path: `${dir}/users.png` });
  await page.goto(`/users/${p}01`);
  await expect(page.getByRole('button', { name: '强制下线' })).toBeVisible();
  await page.getByRole('button', { name: '强制下线' }).click();
  await page.screenshot({ path: `${dir}/kick.png` });
  await page.goto(`/groups/${p}-g`);
  await expect(page.getByRole('button', { name: '解散群' })).toBeVisible();
  await page.screenshot({ path: `${dir}/group.png`, fullPage: true });
});

test('invite screens', async ({ page }) => {
  const dir = process.env.SHOTS!;
  const op = await provision('yunying', 'operator', 'support');
  const api = await loginApi(op);
  const INV = '/console/api/invites';
  const exp = clockNow() + 7 * 86_400_000;
  const make = async (note: string, maxUses = 2) =>
    (await api.call<{ invites: { inviteId: string; code: string }[] }>('POST', INV, { maxUses, expiresAt: exp, note }))
      .invites[0]!;
  const register = (username: string, inviteCode: string) =>
    imAccountPost('/v1/account/register', { username, password: 'Tt-pass-2026!', platform: 'android', inviteCode });
  const used = await make('已用完的样例');
  const u1 = uid('shot');
  await register(u1, used.code);
  await imAccountPost('/v1/account/login', { username: u1, password: 'Tt-pass-2026!', platform: 'ios' });
  await register(uid('shot'), used.code);
  const off = await make('手动停用的样例');
  await api.call('POST', `${INV}/${off.inviteId}/disable`, {});
  const auto = await make('自动停用的样例', 100);
  const taken = uid('shot');
  await register(taken, auto.code);
  for (let i = 0; i < 20; i++) await register(taken, auto.code);
  await make('春季活动渠道，备注可以比较长一些，看看表格怎么换行，避免把状态列挤没了');
  const demo = uid('demo');
  await imUsers([{ userId: demo, nickname: '演示用户' }]);

  await login(page, op);
  await page.goto('/invites');
  await expect(page.getByText('已停用（自动）').first()).toBeVisible();
  await page.screenshot({ path: `${dir}/invites-list.png` });
  await page.getByRole('button', { name: '生成邀请码' }).click();
  await page.screenshot({ path: `${dir}/invites-dialog.png` });
  const dlg = page.getByRole('dialog', { name: '生成邀请码' });
  await dlg.getByLabel('数量').fill('3');
  await dlg.getByLabel('每个可用次数').fill('2');
  await dlg.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('region', { name: '刚生成的邀请码' })).toBeVisible();
  await page.screenshot({ path: `${dir}/invites-created.png` });
  await page.goto(`/users/${u1}`);
  await expect(page.getByRole('heading', { name: '账号信息' })).toBeVisible();
  await page.screenshot({ path: `${dir}/user-account.png`, fullPage: true });
  await page.goto(`/users/${demo}`);
  await expect(page.getByRole('heading', { name: '账号信息' })).toBeVisible();
  await page.screenshot({ path: `${dir}/user-no-account.png`, fullPage: true });
  await page.route(`**/console/api/users/${demo}`, async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, json: { ...(await r.json()), account: null, accountUnavailable: true } });
  });
  await page.reload();
  await expect(page.getByText('暂不可用')).toBeVisible();
  await page.screenshot({ path: `${dir}/user-account-unavailable.png`, fullPage: true });
});
