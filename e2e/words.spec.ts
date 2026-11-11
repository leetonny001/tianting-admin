// FE-696：词库页和命中统计（PRD-chat F-MOD-01、F-MOD-02 规则 7，第 14.1 节；AC-MOD-01-7，P-48 ③）。
// 真实 console-server（CS-206）+ im-server（IM_MOD_ENABLED=1）+ Postgres；页面是生产构建，响应头是生产 CSP。
// 只用特征词 ZXQ-*（F-MOD-01 规则 5）。
import { expect, test, type Page } from '@playwright/test';
import { imGroup, imUsers, login, provision, uid, watchPage } from './helpers';
import { imConn, token } from './im-files';

const txt = (lines: string[]) => ({ name: 'words.txt', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) });

async function gotoWords(page: Page) {
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '词库' }).click();
  await expect(page.getByRole('heading', { name: '词库' })).toBeVisible();
}

test('AC-MOD-01-7 词库页：添加、批量导入（结果汇总）、搜索、停用，内容按纯文本；停用后 10 秒内生效', async ({
  page,
}) => {
  const problems = watchPage(page);
  const tag = uid('');
  const html = `<b>ZXQ-W-${tag}</b>`;
  const w1 = `ZXQ-I-${tag}-1`;
  const w2 = `ZXQ-I-${tag}-2`;
  const mod = await provision('mw', 'moderator');
  const imports: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/moderation/words/import')) imports.push(r.postData() ?? '');
  });
  await login(page, mod);
  await gotoWords(page);

  // 单个添加：含 HTML 的词按纯文本显示。
  await page.getByLabel('词', { exact: true }).fill(html);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  // 写操作先确认（PRD-admin 5.3 节）。
  await page.getByRole('dialog', { name: '添加词' }).getByRole('button', { name: '添加' }).click();
  await expect(page.getByText('已添加')).toBeVisible();
  const table = page.getByRole('table', { name: '词库' });
  await expect(table.getByText(html, { exact: true })).toBeVisible();
  expect(await table.locator('b').count()).toBe(0);

  // 超过 5000 行：直接提示，不提交。
  await page.getByLabel('选择文件').setInputFiles(txt(Array.from({ length: 5001 }, (_, i) => `ZXQ-X-${tag}-${i}`)));
  await expect(page.getByText('一次最多 5000 条', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(imports).toEqual([]);

  // 批量导入：2 个新的，1 个重复（同一批里前面有），空行和 65 个字的无效。
  await page.getByLabel('选择文件').setInputFiles(txt([w1, ` ${w2} `, '', 'Z'.repeat(65), w1, '']));
  const dlg = page.getByRole('dialog', { name: '批量导入' });
  await expect(dlg).toContainText('将导入 5 行');
  await dlg.getByRole('button', { name: '导入' }).click();
  await expect(page.getByText('导入完成：新增 2，重复 1，无效 2')).toBeVisible();
  expect(JSON.parse(imports[0]!)).toEqual({ words: [w1, w2, '', 'Z'.repeat(65), w1] });

  // 搜索。
  await page.getByLabel('搜索').fill(`ZXQ-I-${tag}`);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table).not.toContainText(html);

  // 停用 w1：确认后状态变成"已停用"。
  const row1 = table.getByRole('row').filter({ hasText: w1 });
  await row1.getByRole('button', { name: '停用' }).click();
  await page.getByRole('dialog', { name: '停用词' }).getByRole('button', { name: '停用' }).click();
  await expect(row1).toContainText('已停用');
  await expect(row1.getByRole('button', { name: '启用' })).toBeVisible();

  // 真实效果：w2 被拦截（4510），停用的 w1 能发出去。
  const u = uid('wu');
  const g = uid('wg');
  await imUsers([{ userId: u }]);
  await imGroup(g, 'n', [u]);
  const c = await imConn(await token(u));
  await expect
    .poll(async () => (await c.post('group', g, 'text', { text: `hi ${w2}` })).code, { timeout: 15_000 })
    .toBe(4510);
  expect((await c.post('group', g, 'text', { text: `hi ${w1}` })).code).toBe(0);
  c.close();

  // 删除 w2（确认框）。
  const row2 = table.getByRole('row').filter({ hasText: w2 });
  await row2.getByRole('button', { name: '删除' }).click();
  await page.getByRole('dialog', { name: '删除词' }).getByRole('button', { name: '删除' }).click();
  await expect(table.getByRole('row')).toHaveCount(2);

  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(problems).toEqual([]);
});

test('命中统计：审核员按用户查次数和最近记录；运营有词库页但没有命中统计（P-48 ③）；客服没有词库', async ({ page }) => {
  const problems = watchPage(page);
  const tag = uid('');
  const word = `ZXQ-H-${tag}`;
  const mod = await provision('mh', 'moderator');
  const op = await provision('oh', 'operator');
  const kf = await provision('kh', 'support');
  const u = uid('hu');
  const g = uid('hg');
  await imUsers([{ userId: u }]);
  await imGroup(g, 'n', [u]);

  await login(page, op);
  await gotoWords(page);
  await expect(page.getByRole('heading', { name: '命中统计' })).toHaveCount(0);
  await page.getByLabel('词', { exact: true }).fill(word);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  // 写操作先确认（PRD-admin 5.3 节）。
  await page.getByRole('dialog', { name: '添加词' }).getByRole('button', { name: '添加' }).click();
  await expect(page.getByText('已添加')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '举报' })).toHaveCount(0);

  const c = await imConn(await token(u));
  await expect
    .poll(async () => (await c.post('group', g, 'text', { text: `x ${word}` })).code, { timeout: 15_000 })
    .toBe(4510);
  c.close();

  await page.context().clearCookies();
  await login(page, mod);
  await gotoWords(page);
  await page.getByLabel('用户 ID').fill(u);
  const hits: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/moderation/hits')) hits.push(await r.text());
  });
  await page.getByRole('button', { name: '查询次数' }).click();
  const counts = page.getByRole('table', { name: '按场景的命中次数' });
  await expect(counts.getByRole('row').nth(1)).toHaveText('文本消息1');
  await expect(page.getByRole('table', { name: '最近的命中' }).getByRole('row')).toHaveCount(2);
  // 响应里没有词和消息内容。
  expect(hits.join('\n')).not.toContain(word);
  await expect(page.getByRole('heading', { name: '命中统计' }).locator('..')).not.toContainText(word);

  await page.context().clearCookies();
  await login(page, kf);
  await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '词库' })).toHaveCount(0);
  await page.goto('/moderation/words');
  await expect(page.getByRole('heading', { name: '无权限' })).toBeVisible();
  expect(problems).toEqual([]);
});
