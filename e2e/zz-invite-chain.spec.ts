import { expect, test } from '@playwright/test';
import { login, provision, uid } from './helpers';

// FE-620 AC-ACC-09-1 的完整链路：后台页面真实生成（console-server → im-server），H5 注册页真实注册，后台列表看用量。
// 要同时开着连同一个 im-server 的 H5：TT_CHAIN_WEB=http://127.0.0.1:18295（TIANTING_SERVER 指向 E2E_IM_WS_PORT）。默认跳过。结果是 Chrome，本地。
const WEB = process.env.TT_CHAIN_WEB;
const PASSWORD = 'correct-horse-9';

test('TC-ACC-09-01 完整链路：后台生成 maxUses=2，H5 前两个注册成功，第三个提示邀请码无效，后台显示已用 2 次', async ({
  page,
  browser,
}) => {
  test.skip(!WEB, '要 TT_CHAIN_WEB');
  const op = await provision('op', 'operator');
  const note = uid('chain');
  await login(page, op);
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '邀请码' }).click();
  await page.getByRole('button', { name: '生成邀请码' }).click();
  const dlg = page.getByRole('dialog', { name: '生成邀请码' });
  await dlg.getByLabel('每个可用次数').fill('2');
  await dlg.getByLabel('备注（可选）').fill(note);
  await dlg.getByRole('button', { name: '生成', exact: true }).click();
  const code = (await page.getByRole('region', { name: '刚生成的邀请码' }).locator('.invite-code').textContent())!;

  const register = async (username: string) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const h5 = await ctx.newPage();
    await h5.goto(`${WEB}/login/account`);
    await h5.getByTestId('go-register').click();
    await h5.getByTestId('register-username').fill(username);
    await h5.getByTestId('register-password').fill(PASSWORD);
    await h5.getByTestId('register-invite').fill(code);
    await h5.getByTestId('register-submit').click();
    return { ctx, h5 };
  };
  const stamp = Date.now().toString(36);
  for (const n of [1, 2]) {
    const { ctx, h5 } = await register(`chain${stamp}${n}`);
    await expect(h5.getByTestId('recovery-code')).toBeVisible();
    await h5.getByTestId('recovery-ack').click();
    await expect(h5.getByTestId('tab-chats')).toBeVisible();
    await ctx.close();
  }
  const { ctx, h5 } = await register(`chain${stamp}3`);
  await expect(h5.getByText('邀请码无效')).toBeVisible();
  await expect(h5.getByTestId('recovery-code')).toHaveCount(0);
  await ctx.close();

  await page.reload();
  const row = page.getByRole('row', { name: new RegExp(note) });
  await expect(row).toContainText('2 / 2');
  await expect(row).toContainText(code.slice(-4));
  await expect(row).not.toContainText(code);
});
