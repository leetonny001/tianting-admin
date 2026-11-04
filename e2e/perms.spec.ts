import { expect, test } from '@playwright/test';
import {
  clockNow,
  freshOtp,
  imGroup,
  imUsers,
  login,
  provision,
  REASON,
  root,
  rootAccount,
  setFault,
  stepUp,
  uid,
  watchPage,
} from './helpers';

test('菜单和无权限页（AC-ADM-05-3、05-5）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  await login(page, kf);
  const nav = page.getByRole('navigation', { name: '主菜单' });
  for (const name of ['账号管理', '审计日志', '社交配置']) await expect(nav.getByRole('link', { name })).toHaveCount(0);
  for (const path of ['/accounts', '/audit', '/social/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: '无权限' })).toBeVisible();
  }
});

test('多角色显示并集（AC-ADM-05-5）', async ({ page }) => {
  const a = await provision('mix', 'support', 'operator');
  await login(page, a);
  const nav = page.getByRole('navigation', { name: '主菜单' });
  await expect(nav.getByRole('link', { name: '消息元数据' })).toBeVisible(); // 客服
  await expect(nav.getByRole('link', { name: '用户导入' })).toBeVisible(); // 运营
  await expect(page.getByText('客服、运营').or(page.getByText('运营、客服'))).toBeVisible();
});

test('step-up：输错留在框内，输对自动完成（AC-CON-07-3、07-6、ADM-24-1、24-6）', async ({ page }) => {
  const problems = watchPage(page);
  const op = await provision('op', 'operator');
  const g = uid('g');
  const u = uid('u');
  await imUsers([{ userId: u }]);
  await imGroup(g, '违规群', [u]);
  await login(page, op);
  await page.goto(`/groups/${g}`);
  await page.getByRole('button', { name: '解散群' }).click();
  const confirm = page.getByRole('dialog', { name: '解散群' });
  await confirm.getByLabel('理由').fill(REASON);
  await confirm.getByLabel(`请输入 ${g} 确认`).fill('wrong');
  await expect(confirm.getByRole('button', { name: '解散' })).toBeDisabled();
  await confirm.getByLabel(`请输入 ${g} 确认`).fill(g);
  // 登录时的动态码验证不算 step-up：让窗口过期后再操作。
  await confirm.getByRole('button', { name: '解散' }).click();
  const dlg = page.getByRole('dialog', { name: '输入动态码确认' });
  await dlg.getByLabel('动态码').fill('000000');
  await dlg.getByRole('button', { name: '验证' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('动态码错误');
  await expect(page).toHaveURL(new RegExp(`/groups/${g}$`));
  await dlg.getByLabel('动态码').fill(await freshOtp(op.seed));
  await dlg.getByRole('button', { name: '验证' }).click();
  // 不需要再点一次：自动解散并回到列表。
  await expect(page).toHaveURL(/\/groups$/);
  // 默认列表没有；勾选"包含已解散"才出现，并标记（AC-ADM-20-3）。
  await page.goto(`/groups?q=${g}`);
  await expect(page.getByText('没有找到群')).toBeVisible();
  await page.goto(`/groups?q=${g}&includeDissolved=true`);
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: g })
      .getByText(/已解散/),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('step-up 取消：操作没执行，确认框还在', async ({ page }) => {
  const op = await provision('op', 'operator');
  const g = uid('g');
  const u = uid('u');
  await imUsers([{ userId: u }]);
  await imGroup(g, '群', [u]);
  await login(page, op);
  await page.goto(`/groups/${g}`);
  await page.getByRole('button', { name: '解散群' }).click();
  const confirm = page.getByRole('dialog', { name: '解散群' });
  await confirm.getByLabel('理由').fill(REASON);
  await confirm.getByLabel(`请输入 ${g} 确认`).fill(g);
  await confirm.getByRole('button', { name: '解散' }).click();
  await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '取消' }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('alert')).toHaveCount(0);
  await confirm.getByRole('button', { name: '取消' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '群', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '解散群' })).toBeVisible(); // 没解散
});

test('审计写失败的提示（5031）', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const u = uid('u');
  await imUsers([{ userId: u }]);
  await login(page, kf);
  await page.goto(`/users/${u}`);
  await setFault('fail');
  try {
    await page.getByRole('button', { name: '强制下线' }).click();
    await page.getByLabel('理由').fill(REASON);
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.getByRole('alert')).toHaveText('审计服务不可用，操作未执行');
  } finally {
    await setFault('ok');
  }
});

test('账号管理（FE-403）', async ({ page }) => {
  const a = rootAccount;
  await root();
  const problems = watchPage(page);
  await login(page, a());
  await page.goto('/accounts');
  // 自己的账号没有操作。
  const self = page.getByRole('row').filter({ hasText: 'root1' });
  await expect(self.getByRole('button', { name: '停用' })).toHaveCount(0);
  await expect(self.getByText('自己的账号')).toBeVisible();
  await page.getByRole('button', { name: '新建账号' }).click();
  const dlg = page.getByRole('dialog', { name: '新建账号' });
  const name = uid('new');
  await dlg.getByLabel('账号名').fill(name);
  await dlg.getByLabel('显示名').fill('新人');
  // 审计员互斥。
  await dlg.getByLabel('审计员').check();
  await expect(dlg.getByLabel('客服')).toBeDisabled();
  await dlg.getByLabel('审计员').uncheck();
  await dlg.getByLabel('客服').check();
  await expect(dlg.getByLabel('审计员')).toBeDisabled();
  await dlg.getByRole('button', { name: '创建' }).click();
  await page
    .getByRole('dialog', { name: '输入动态码确认' })
    .getByLabel('动态码')
    .fill(await freshOtp(a().seed));
  await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '验证' }).click();
  await expect(page.getByTestId('activation-code')).not.toBeEmpty();
  await page.getByRole('button', { name: '我已记下' }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row.getByText('待激活')).toBeVisible();
  await row.getByRole('button', { name: '停用' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认' }).click();
  await expect(row.getByText('已停用')).toBeVisible();
  expect(problems).toEqual([]);
});

test('应急授权：拿到服务端的到期时间，菜单马上变化（AC-CON-06-7）', async ({ page }) => {
  const r = await root();
  await stepUp(r, rootAccount());
  const otherName = uid('sa');
  const created = await r.call<{ id: string }>('POST', '/console/api/accounts', {
    username: otherName,
    displayName: otherName,
    roles: ['super_admin'],
  });
  expect(created.id).toBeTruthy();
  await login(page, rootAccount());
  await page.goto('/accounts');
  await page.getByLabel('时长（分钟）').fill('30');
  await page.getByLabel('理由').fill(REASON);
  await page.getByRole('button', { name: '申请' }).click();
  await page.getByRole('dialog', { name: '确认应急授权' }).getByRole('button', { name: '确认' }).click();
  const dlg = page.getByRole('dialog', { name: '输入动态码确认' });
  await dlg.getByLabel('动态码').fill(await freshOtp(rootAccount().seed));
  await dlg.getByRole('button', { name: '验证' }).click();
  await expect(page.getByText(/已授权，到期时间/)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '消息元数据' }),
  ).toBeVisible();
  expect(clockNow()).toBeGreaterThan(0);
});
