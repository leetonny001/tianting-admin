import { expect, test } from '@playwright/test';
import { imGroup, imUsers, login, provision, REASON, uid, watchPage } from './helpers';
import { dialIM, imSend } from './ws';

const XSS = '<img src=x onerror=alert(1)>';

test('建群：校验和错误文案（AC-ADM-21-1～21-5）', async ({ page }) => {
  const problems = watchPage(page);
  const op = await provision('op', 'operator');
  const p = uid('g');
  const ms = [`${p}a`, `${p}b`, `${p}c`];
  await imUsers(ms.map((userId) => ({ userId })));
  const conn = await dialIM(ms[0]!, 'web');
  await login(page, op);
  await page.goto('/groups/new');
  // 2001 人不发请求。
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/console/api/groups')) posts++;
  });
  await page.getByLabel('群 ID').fill(`${p}-1`);
  await page.getByLabel('群名').fill('活动群');
  await page.getByLabel('初始成员').fill(Array.from({ length: 2001 }, (_, i) => `z${i}`).join(' '));
  await expect(page.getByText('群成员最多 2000 人')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建' })).toBeDisabled();
  expect(posts).toBe(0);
  // 不存在的用户。
  await page.getByLabel('初始成员').fill(`${ms[0]} ghost-${p}`);
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('alert')).toHaveText(`用户不存在：ghost-${p}`);
  // ug- 前缀。
  await page.getByLabel('群 ID').fill('ug-abc');
  await page.getByLabel('初始成员').fill(ms.join('\n'));
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('alert')).toContainText('ID 格式不正确');
  // 成功。
  await page.getByLabel('群 ID').fill(`${p}-1`);
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('heading', { name: '活动群' })).toBeVisible();
  await conn.waitEvent('convAdded');
  // 已存在。
  await page.goto('/groups/new');
  await page.getByLabel('群 ID').fill(`${p}-1`);
  await page.getByLabel('群名').fill('x');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('alert')).toHaveText('群 ID 已存在');
  expect(problems).toEqual([]);
});

test('群列表和详情（AC-ADM-20-1、22-x、23-3、25-3、CON-10-2）', async ({ page }) => {
  const op = await provision('op', 'operator');
  const p = uid('h');
  const ms = [`${p}u10`, `${p}u11`, `${p}u2`];
  await imUsers([...ms, `${p}new`, `${p}eve`].map((userId) => ({ userId })));
  await imGroup(`${p}-a`, XSS, ms);
  await imGroup(`${p}-b`, '另一个', ms.slice(0, 1));
  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await login(page, op);
  await page.goto(`/groups?q=${p}-`);
  await expect(page.getByRole('link', { name: `${p}-a` })).toBeVisible();
  await expect(page.getByRole('link', { name: `${p}-b` })).toBeVisible();
  await expect(page.getByRole('cell', { name: XSS })).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: `${p}-a` })
      .getByRole('cell', { name: '3', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: `${p}-a` }).click();
  await expect(page.getByRole('heading', { name: XSS })).toBeVisible();
  expect(await page.locator('img').count()).toBe(0);
  expect(dialogs).toBe(0);

  // 成员筛选（AC-ADM-22-6）。
  await page.getByLabel('筛选').fill(`${p}u1`);
  await page.getByRole('button', { name: '筛选' }).click();
  await expect(page.getByRole('link', { name: `${p}u10` })).toBeVisible();
  await expect(page.getByRole('link', { name: `${p}u2` })).toHaveCount(0);
  await page.getByLabel('筛选').fill('');
  await page.getByRole('button', { name: '筛选' }).click();

  // 群名校验（AC-ADM-23-3）。
  const name = page.getByLabel('群名');
  await name.fill('');
  await expect(page.getByText('群名不能为空')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存群名' })).toBeDisabled();
  await name.fill('长'.repeat(51));
  await expect(page.getByText('群名最多 50 个字符')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存群名' })).toBeDisabled();
  await name.fill('新名字');
  await page.getByRole('button', { name: '保存群名' }).click();
  await page.getByRole('dialog', { name: '修改群名' }).getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('heading', { name: '新名字' })).toBeVisible();

  // 历史可见的影响说明。
  await page.getByRole('button', { name: '打开新成员看历史' }).click();
  const h = page.getByRole('dialog', { name: '修改历史可见' });
  await expect(h).toContainText('所有成员（包括已入群的）都能看到入群前的历史');
  await h.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('button', { name: '关闭新成员看历史' })).toBeVisible();

  // 加人、移除。
  await page.getByLabel('加入或移除的成员').fill(`${p}new`);
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await page.getByRole('dialog', { name: '加入成员' }).getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('link', { name: `${p}new` })).toBeVisible();
  await page.getByLabel('加入或移除的成员').fill(`${p}new`);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  const rm = page.getByRole('dialog', { name: '移除成员' });
  await rm.getByLabel('理由').fill(REASON);
  await rm.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('link', { name: `${p}new` })).toHaveCount(0);

  // 群主：非成员、成员、收回。
  await page.getByLabel('新群主 userId').fill(`${p}eve`);
  await page.getByRole('button', { name: '设置群主' }).click();
  const o = page.getByRole('dialog', { name: '设置群主' });
  await o.getByLabel('理由').fill(REASON);
  await o.getByRole('button', { name: '确认' }).click();
  await expect(o.getByRole('alert')).toHaveText('该用户不是群成员');
  await o.getByRole('button', { name: '取消' }).click();
  await page.getByLabel('新群主 userId').fill(ms[0]!);
  await page.getByRole('button', { name: '设置群主' }).click();
  await page.getByRole('dialog', { name: '设置群主' }).getByLabel('理由').fill(REASON);
  await page.getByRole('dialog', { name: '设置群主' }).getByRole('button', { name: '确认' }).click();
  await expect(page.locator('.kv').getByText(ms[0]!)).toBeVisible();
});

test('元数据：翻页、没有正文、单聊要理由（AC-ADM-30-1、30-2、CON-10-2）', async ({ page }) => {
  const problems = watchPage(page);
  const kf = await provision('kf', 'support');
  const p = uid('m');
  const u = `${p}a`;
  await imUsers([{ userId: u }, { userId: `${p}b`, nickname: XSS }]);
  await imGroup(`${p}-g`, '群', [u, `${p}b`]);
  await imSend(u, `${p}-g`, 60);
  await imSend(`${p}b`, `${p}-g`, 3);
  await login(page, kf);
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill('c2c:a');
  await expect(page.getByText('会话 ID 格式不正确')).toBeVisible();
  await expect(page.getByRole('button', { name: '查询' })).toBeDisabled();
  await page.getByLabel('会话 ID').fill(`group:${p}-g`);
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByRole('row')).toHaveCount(51);
  await page.getByRole('button', { name: '加载更多' }).click();
  await expect(page.getByRole('row')).toHaveCount(64);
  await expect(page.getByText('没有更多了')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('ZXQ-BODY-123');
  // 按发送者。
  await page.getByLabel('发送者').fill(`${p}b`);
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByRole('row')).toHaveCount(4);

  // 单聊：先填理由。会话 ID 不进 URL。
  await page.getByLabel('发送者').fill('');
  await page.getByLabel('会话 ID').fill(`c2c:${p}x:${p}y`);
  await page.getByRole('button', { name: '查询' }).click();
  const d = page.getByRole('dialog', { name: '查询单聊元数据' });
  await d.getByLabel('理由').fill(REASON);
  await d.getByRole('button', { name: '查询' }).click();
  await expect(page.getByText('这个会话没有消息')).toBeVisible();
  expect(page.url()).toMatch(/\/messages$/);
  expect(problems).toEqual([]);
});

test('从群详情进入元数据（AC-ADM-24-4）', async ({ page }) => {
  const mod = await provision('mod', 'moderator');
  const p = uid('n');
  await imUsers([{ userId: `${p}a` }]);
  await imGroup(`${p}-g`, '群', [`${p}a`]);
  await imSend(`${p}a`, `${p}-g`, 2);
  await login(page, mod);
  await page.goto(`/groups/${p}-g`);
  await page.getByRole('button', { name: '查看消息元数据' }).click();
  await expect(page).toHaveURL(/\/messages$/);
  await expect(page.getByRole('row')).toHaveCount(3);
});
