import { expect, test, type Page } from '@playwright/test';
import {
  clockNow,
  imAccountPost,
  imUsers,
  login,
  loginApi,
  provision,
  root,
  setFault,
  setIMFaults,
  uid,
  watchPage,
} from './helpers';

// FE-619（CS-200）：邀请码页和用户详情的账号信息。连真实的 console-server、im-server（invite 模式）、Postgres。

const INVITES = '/console/api/invites';
const USER_PASSWORD = 'Tt-pass-2026!';

interface Created {
  inviteId: string;
  code: string;
  codeLast4: string;
}

const register = (username: string, inviteCode: string) =>
  imAccountPost('/v1/account/register', { username, password: USER_PASSWORD, platform: 'android', inviteCode });

const body = (over: Record<string, unknown> = {}) => ({ maxUses: 1, expiresAt: clockNow() + 86_400_000, ...over });

async function fillGenerate(page: Page, values: { maxUses?: string; note?: string; count?: string }) {
  await page.getByRole('button', { name: '生成邀请码' }).click();
  const dlg = page.getByRole('dialog', { name: '生成邀请码' });
  if (values.count) await dlg.getByLabel('数量').fill(values.count);
  if (values.maxUses) await dlg.getByLabel('每个可用次数').fill(values.maxUses);
  if (values.note) await dlg.getByLabel('备注（可选）').fill(values.note);
  await dlg.getByRole('button', { name: '生成', exact: true }).click();
  return dlg;
}

test('TC-ACC-09-01 运营生成 maxUses=2，三个用户注册，后台显示已用 2 次；明文只出现一次', async ({ page, context }) => {
  const problems = watchPage(page);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  const listBodies: Promise<string>[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === INVITES && r.request().method() === 'GET') listBodies.push(r.text());
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const op = await provision('op', 'operator');
  const note = uid('note');
  await login(page, op);
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '邀请码' }).click();
  await expect(page).toHaveURL(/\/invites$/);

  const dlg = await fillGenerate(page, { maxUses: '2', note });
  await expect(dlg).toHaveCount(0);
  const panel = page.getByRole('region', { name: '刚生成的邀请码' });
  await expect(panel).toContainText('明文只显示这一次');
  const code = (await panel.locator('.invite-code').textContent())!;
  expect(code.length).toBeGreaterThanOrEqual(22); // 128 位 base64url

  // 复制到的就是明文。
  await panel.getByRole('button', { name: '复制', exact: true }).click();
  await expect(panel.getByRole('button', { name: '已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // 只有这一处有明文：存储、URL、history、日志都没有。
  const stored = await page.evaluate(() =>
    JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, h: history.state, c: document.cookie }),
  );
  expect(stored).not.toContain(code);
  expect(page.url()).not.toContain(code);
  expect(logs.join('\n')).not.toContain(code);

  // 列表只有后 4 位。
  const row = page.getByRole('row', { name: new RegExp(note) });
  await expect(row).toContainText(code.slice(-4));
  await expect(row).toContainText('0 / 2');
  await expect(row).toContainText('可用');
  await expect(row).toContainText(`管理员 ${op.id}`);
  await expect(row).not.toContainText('console:admin');
  await expect(row).not.toContainText(code);

  // 前两个成功，第三个 403 / 4030。
  const [a, b, c] = [uid('r'), uid('r'), uid('r')];
  expect((await register(a, code)).status).toBe(200);
  expect((await register(b, code)).status).toBe(200);
  const third = await register(c, code);
  expect(third.status).toBe(403);
  expect(third.body.code).toBe(4030);

  // 离开页面再回来：明文没有了，已用 2 次。
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '首页' }).click();
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '邀请码' }).click();
  await expect(row).toContainText('2 / 2');
  await expect(row).toContainText('已用完');
  await expect(page.locator('body')).not.toContainText(code);
  await expect(page.getByRole('region', { name: '刚生成的邀请码' })).toHaveCount(0);

  // 刷新同样没有；列表接口的响应里也没有明文。
  await page.reload();
  await expect(row).toContainText('2 / 2');
  await expect(page.locator('body')).not.toContainText(code);
  for (const text of await Promise.all(listBodies)) expect(text).not.toContain(code);
  expect(problems).toEqual([]);
});

test('生成后刷新页面明文就没有了', async ({ page }) => {
  const op = await provision('op', 'operator');
  await login(page, op);
  await page.goto('/invites');
  await fillGenerate(page, {});
  const panel = page.getByRole('region', { name: '刚生成的邀请码' });
  const code = (await panel.locator('.invite-code').textContent())!;
  await page.reload();
  await expect(page.getByRole('heading', { name: '邀请码' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(code);
  await expect(panel).toHaveCount(0);
});

test('TC-ACC-09-03 停用：只要确认框，立即生效，不能再注册', async ({ page }) => {
  const problems = watchPage(page);
  const op = await provision('op', 'operator');
  const opApi = await loginApi(op);
  const note = uid('note');
  const { invites } = await opApi.call<{ invites: Created[] }>('POST', INVITES, body({ note, maxUses: 5 }));
  await login(page, op);
  await page.goto('/invites');
  const row = page.getByRole('row', { name: new RegExp(note) });
  await row.getByRole('button', { name: '停用' }).click();
  const dlg = page.getByRole('dialog', { name: '停用邀请码' });
  await expect(dlg.getByLabel('理由')).toHaveCount(0);
  await dlg.getByRole('button', { name: '停用' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(row).toContainText('已停用');
  await expect(row).not.toContainText('自动');
  await expect(row.getByRole('button', { name: '停用' })).toHaveCount(0);
  const r = await register(uid('r'), invites[0]!.code);
  expect(r.status).toBe(403);
  expect(r.body.code).toBe(4030);
  expect(problems).toEqual([]);
});

test('已停用（自动）：同一邀请码 20 次用户名已占用后，列表这样显示', async ({ page }) => {
  const op = await provision('op', 'operator');
  const opApi = await loginApi(op);
  const note = uid('note');
  const { invites } = await opApi.call<{ invites: Created[] }>('POST', INVITES, body({ note, maxUses: 100 }));
  const code = invites[0]!.code;
  const taken = uid('r');
  expect((await register(taken, code)).status).toBe(200);
  for (let i = 0; i < 20; i++) expect((await register(taken, code)).body.code).toBe(4095);
  await login(page, op);
  await page.goto('/invites');
  const row = page.getByRole('row', { name: new RegExp(note) });
  await expect(row).toContainText('已停用（自动）');
  await expect(row.getByRole('button', { name: '停用' })).toHaveCount(0);
});

test('TC-ACC-09-04 权限：超管、客服、审计员没有菜单和页面，接口 403；运营有', async ({ page }) => {
  const problems = watchPage(page);
  const r = await root();
  const kf = await provision('kf', 'support');
  const au = await provision('au', 'auditor');
  await expect(r.call('GET', INVITES)).rejects.toThrow(/403.*4030/);
  for (const a of [kf, au]) {
    await expect((await loginApi(a)).call('POST', INVITES, body())).rejects.toThrow(/403.*4030/);
    await page.context().clearCookies();
    await login(page, a);
    await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '邀请码' })).toHaveCount(0);
    await page.goto('/invites');
    await expect(page.getByRole('heading', { name: '无权限' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '邀请码' })).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test('TC-ACC-09-06 审计写失败：提示 5031，邀请码没有产生', async ({ page }) => {
  const op = await provision('op', 'operator');
  const opApi = await loginApi(op);
  const note = uid('note');
  await login(page, op);
  await page.goto('/invites');
  await setFault('fail');
  try {
    const dlg = await fillGenerate(page, { note });
    await expect(dlg.getByRole('alert')).toHaveText('审计服务不可用，操作未执行');
    await expect(page.getByRole('region', { name: '刚生成的邀请码' })).toHaveCount(0);
  } finally {
    await setFault('ok');
  }
  const { invites } = await opApi.call<{ invites: { note?: string }[] }>('GET', `${INVITES}?limit=100`);
  expect(invites.filter((i) => i.note === note)).toEqual([]);
  // 恢复后留在框里就能再提交。
  const dlg = page.getByRole('dialog', { name: '生成邀请码' });
  await dlg.getByRole('button', { name: '生成', exact: true }).click();
  await expect(page.getByRole('region', { name: '刚生成的邀请码' })).toBeVisible();
});

test('结果未知 5040：生成被锁，列表能看到多出来的邀请码并停用，确认后才能重新生成', async ({ page }) => {
  const op = await provision('op', 'operator');
  const note = uid('note');
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === INVITES) posts += 1;
  });
  await login(page, op);
  await page.goto('/invites');
  await setIMFaults({ imDropResponse: true });
  let dlg;
  try {
    dlg = await fillGenerate(page, { note, count: '2' });
    await expect(page.getByRole('alert').filter({ hasText: '生成结果未知' })).toContainText('最多 2 条');
  } finally {
    await setIMFaults({});
  }
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成邀请码' })).toBeDisabled();
  await expect(page.getByRole('region', { name: '刚生成的邀请码' })).toHaveCount(0);
  expect(posts).toBe(1);

  // im-server 其实生成了，明文没人知道：停用这两条。
  const rows = page.getByRole('row', { name: new RegExp(note) });
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole('row', { name: new RegExp(note) })
      .getByRole('button', { name: '停用' })
      .first()
      .click();
    const confirm = page.getByRole('dialog', { name: '停用邀请码' });
    await confirm.getByRole('button', { name: '停用' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(rows.getByText('已停用')).toHaveCount(i + 1);
  }
  await expect(page.getByRole('button', { name: '生成邀请码' })).toBeDisabled();
  await page.getByRole('button', { name: '已核对并停用，重新生成' }).click();
  await expect(page.getByRole('button', { name: '生成邀请码' })).toBeEnabled();
  expect(posts).toBe(1);
});

test('列表翻页：加载更多接得上，没有重复', async ({ page }) => {
  const op = await provision('op', 'operator');
  const opApi = await loginApi(op);
  await opApi.call('POST', INVITES, body({ count: 60 }));
  await login(page, op);
  await page.goto('/invites');
  const rows = page.getByRole('row');
  await expect(rows).toHaveCount(51); // 表头 + 默认 50 条
  await page.getByRole('button', { name: '加载更多' }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(51);
  const ids = await page.locator('tbody tr td.mono').allTextContents();
  expect(ids.length).toBeGreaterThanOrEqual(60);
  expect(new Set(ids).size).toBe(ids.length);
});

test('审计页有生成、停用的动作名，审计里没有明文', async ({ page }) => {
  const op = await provision('op', 'operator');
  const au = await provision('au', 'auditor');
  const opApi = await loginApi(op);
  const { invites } = await opApi.call<{ invites: Created[] }>('POST', INVITES, body());
  await opApi.call('POST', `${INVITES}/${invites[0]!.inviteId}/disable`, {});
  const seen: Promise<string>[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname === '/console/api/audit') seen.push(r.text());
  });
  await login(page, au);
  await page.goto('/audit');
  for (const name of ['生成邀请码', '停用邀请码']) {
    await page.getByLabel('动作').selectOption({ label: name });
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(op.username) }).first()).toContainText(name);
  }
  for (const text of await Promise.all(seen)) expect(text).not.toContain(invites[0]!.code);
});

test('TC-ACC-09-09 用户详情显示账号信息，没有重置密码', async ({ page }) => {
  const problems = watchPage(page);
  const op = await provision('op', 'operator');
  const kf = await provision('kf', 'support');
  const { invites } = await (await loginApi(op)).call<{ invites: Created[] }>('POST', INVITES, body());
  const u1 = uid('acct');
  // 注册一条会话，登录再一条。
  expect((await register(u1, invites[0]!.code)).status).toBe(200);
  const again = await imAccountPost('/v1/account/login', { username: u1, password: USER_PASSWORD, platform: 'ios' });
  expect(again.status).toBe(200);

  await login(page, kf);
  await page.goto(`/users/${u1}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: '账号信息' }) });
  const when = /\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/;
  await expect(panel.locator('dd').nth(0)).toHaveText('有账号');
  await expect(panel.locator('dt').nth(1)).toHaveText('注册时间');
  await expect(panel.locator('dd').nth(1)).toHaveText(when);
  await expect(panel.locator('dt').nth(2)).toHaveText('最近登录时间');
  await expect(panel.locator('dd').nth(2)).toHaveText(when);
  await expect(panel.locator('dt').nth(3)).toHaveText('设备会话数');
  await expect(panel.locator('dd').nth(3)).toHaveText('2');
  await expect(page.getByRole('main')).not.toContainText(/重置|重设|改密|修改密码|恢复码|reset/i);
  await expect(page.getByRole('main').getByRole('button', { name: /重置|密码|恢复码/ })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: /重置|密码|恢复码/ })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('TC-ACC-09-11 演示用户显示没有账号', async ({ page }) => {
  const kf = await provision('kf', 'support');
  const demo = uid('demo');
  await imUsers([{ userId: demo, nickname: '演示' }]);
  await login(page, kf);
  await page.goto(`/users/${demo}`);
  const panel = page.locator('section', { has: page.getByRole('heading', { name: '账号信息' }) });
  await expect(panel).toContainText('没有账号');
  await expect(panel).not.toContainText('注册时间');
  await expect(panel).not.toContainText('暂不可用');
});
