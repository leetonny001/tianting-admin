// FE-671：后台的撤回状态、引用和提及、经代理查看文件（PRD-chat C4 第 11.6、14.1 节；AC-RCL-04-3、04-7、04-9）。
// 真实 console-server（CS-204、CS-202）+ im-server（IM_MSG_ACTIONS_ENABLED=1、IM_FILES_ENABLED=1，假 S3）+ Postgres；
// 页面是生产构建，响应头是生产 CSP。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshOtp, imGroup, imUsers, login, provision, uid, watchPage } from './helpers';
import { imConn, imState, png, token, upload } from './im-files';

const SECRET = 'ZXQ-RCL-ADM';
const QUOTED = 'QUOTED-671 原话';
const REASON = '撤回消息取证核查';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** 群 g：u 发一条普通文字、一条引用它并 @ u2 的、一条文字、一个文件、一张图片，后三条撤回。 */
async function world() {
  const u = uid('ru');
  const u2 = uid('rv');
  const g = uid('rg');
  await imUsers([{ userId: u }, { userId: u2 }]);
  await imGroup(g, 'n', [u, u2]);
  const tok = await token(u);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4 rcl '), Buffer.alloc(20_000, 7)]);
  const photo = png(64, 48, 33);
  const fileId = await upload(tok, 'file', `${SECRET}-报告 v2.pdf`, pdf, 'application/pdf');
  const imageId = await upload(tok, 'image', `${SECRET}.png`, photo, 'image/png', png(32, 24));
  const c = await imConn(tok);
  const quoted = await c.send(g, 'text', { text: QUOTED });
  await c.send(g, 'text', { text: '回复一下', quote: { msgId: quoted }, mentions: { userIds: [u2] } });
  const text = await c.send(g, 'text', { text: `${SECRET} 撤回的原文` });
  const file = await c.send(g, 'file', { file: { fileId } });
  const image = await c.send(g, 'image', { image: { fileId: imageId } });
  for (const id of [text, file, image]) await c.recall(`group:${g}`, id);
  c.close();
  return { u, u2, g, pdf, photo, fileId, imageId };
}

async function grant(page: Page, seed: string) {
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('工单号').fill('T-671');
  await page.getByLabel('理由').fill(REASON);
  await page.getByLabel('动态码').fill(await freshOtp(seed));
  await page.getByRole('dialog').getByRole('button', { name: '查看' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('TC-RCL-04-07 元数据页：撤回显示"已撤回（撤回人，时间）"，和删除分开；页面和响应没有文件名、正文（AC-RCL-04-7）', async ({
  page,
}) => {
  const problems = watchPage(page);
  const w = await world();
  const kf = await provision('rk', 'support');
  await login(page, kf);
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/console/api/')) bodies.push(await r.text().catch(() => ''));
  });
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${w.g}`);
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByRole('row')).toHaveCount(6);
  const cells = await page
    .getByRole('row')
    .evaluateAll((rows) => rows.slice(1).map((r) => [r.children[3]!.textContent, r.children[6]!.textContent]));
  // 最新的在上：图片、文件、文字撤回了；引用的那条和被引用的没有。
  expect(cells.map((c) => c[0])).toEqual(['图片', '文件', '文本', '文本', '文本']);
  for (const [, status] of cells.slice(0, 3))
    expect(status).toMatch(new RegExp(`^已撤回（${w.u}，\\d{4}/\\d{2}/\\d{2} [\\d:]{8}）$`));
  expect(cells.slice(3).map((c) => c[1])).toEqual(['', '']);
  await expect(page.locator('body')).not.toContainText('已删除');
  const meta = bodies.filter((b) => b.includes('"bodyLength"')).join('\n');
  expect(meta).toContain('"recalled":true');
  expect(meta).toContain(`"recalledBy":"${w.u}"`);
  await expect(page.locator('body')).not.toContainText(SECRET);
  expect(bodies.join('\n')).not.toContain(SECRET);
  expect(bodies.join('\n')).not.toContain(QUOTED);
  expect(problems).toEqual([]);
});

test('TC-RCL-04-03 TC-RCL-04-09 正文页：普通授权显示撤回文案、引用和提及；隔离授权显示原文，经代理下载查看文件（AC-RCL-04-3、04-9）', async ({
  page,
}) => {
  const problems = watchPage(page);
  const w = await world();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  // 只在测试里记录 blob 地址的创建和撤销（CDP 注入，不受页面 CSP 影响）。
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const c = URL.createObjectURL.bind(URL);
    const r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const u = c(o);
      created.push(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      revoked.push(u);
      r(u);
    };
    (window as unknown as { __blobs: object }).__blobs = { created, revoked };
  });
  const urls: string[] = [];
  const storage: string[] = [];
  const fetches: { url: string; disposition: string; nosniff: string; csp: string }[] = [];
  page.on('request', (r) => {
    urls.push(r.url() + ' ' + (r.postData() ?? ''));
    if (r.url().startsWith(imState().s3)) storage.push(r.url());
  });
  page.on('response', (r) => {
    if (r.url().includes('/console/api/files/'))
      fetches.push({
        url: r.url(),
        disposition: r.headers()['content-disposition'] ?? '',
        nosniff: r.headers()['x-content-type-options'] ?? '',
        csp: r.headers()['content-security-policy'] ?? '',
      });
  });
  const mod = await provision('rm', 'moderator');
  await login(page, mod);
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${w.g}`);
  await page.getByRole('button', { name: '查询' }).click();

  // 普通正文授权：撤回的没有正文，显示撤回文案（AC-RCL-04-3 前半）；引用、提及按纯文本。
  await page.getByRole('button', { name: '查看正文' }).click();
  await grant(page, mod.seed);
  await expect(page.getByText(new RegExp(`^该消息已被撤回（${w.u}，`))).toHaveCount(3);
  await expect(page.getByText(`引用：${QUOTED}`)).toBeVisible();
  await expect(page.getByText(`提及：${w.u2}`)).toBeVisible();
  await expect(page.getByText(/该消息已被删除/)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.getByRole('button', { name: '下载查看' })).toHaveCount(0);

  // 隔离授权：原文（AC-RCL-04-3 后半）和撤回人；撤回的文件、图片可以经代理下载（AC-RCL-04-9）。
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${w.g}`);
  await page.getByRole('button', { name: '查询' }).click();
  await page.getByRole('button', { name: '查看隔离原文' }).click();
  await grant(page, mod.seed);
  await expect(page.getByText(`${SECRET} 撤回的原文`)).toBeVisible();
  await expect(page.getByText(new RegExp(`^撤回人 ${w.u}，`))).toHaveCount(3);
  await expect(page.getByText(`[文件] ${SECRET}-报告 v2.pdf，`, { exact: false })).toBeVisible();
  const buttons = page.getByRole('button', { name: '下载查看' });
  await expect(buttons).toHaveCount(2);

  const rowOf = (text: string | RegExp) => page.locator('.body-row').filter({ hasText: text });
  let wait = page.waitForEvent('download');
  await rowOf('[文件]').getByRole('button', { name: '下载查看' }).click();
  let dl = await wait;
  expect(dl.suggestedFilename()).toBe(`${SECRET}-报告 v2.pdf`);
  expect(sha(readFileSync((await dl.path())!))).toBe(sha(w.pdf));

  wait = page.waitForEvent('download');
  const imageRow = rowOf('[图片]');
  const seq = (await imageRow.locator('p.muted').first().textContent())!.match(/^#(\d+)/)![1];
  await imageRow.getByRole('button', { name: '下载查看' }).click();
  dl = await wait;
  expect(dl.suggestedFilename()).toBe(`图片-${seq}.png`);
  expect(sha(readFileSync((await dl.path())!))).toBe(sha(w.photo));

  // 代理响应：attachment 不带文件名、nosniff；请求是 POST，路径里只有 fileId。
  expect(fetches.map((f) => f.url.replace(/^.*\/console\/api/, ''))).toEqual([
    `/files/${w.fileId}/fetch`,
    `/files/${w.imageId}/fetch`,
  ]);
  for (const f of fetches) {
    expect(f.disposition).toBe('attachment');
    expect(f.nosniff).toBe('nosniff');
  }
  // 页面不内联渲染文件；blob 地址用完就撤销；文件名、原文不进 URL、请求体和控制台。
  expect(await page.locator('.body-area img, .body-area iframe, .body-area object, .body-area embed').count()).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __blobs: { created: string[]; revoked: string[] } }).__blobs),
    )
    .toEqual({ created: [expect.any(String), expect.any(String)], revoked: expect.any(Array) });
  await expect
    .poll(async () => {
      const b = await page.evaluate(
        () => (window as unknown as { __blobs: { created: string[]; revoked: string[] } }).__blobs,
      );
      return b.revoked.length === 2 && b.revoked.every((u) => b.created.includes(u));
    })
    .toBe(true);
  for (const u of urls) {
    expect(u).not.toContain(SECRET);
    expect(u).not.toContain(encodeURIComponent(SECRET));
  }
  expect(logs.join('\n')).not.toContain(SECRET);
  expect(storage).toEqual([]);
  expect(problems).toEqual([]);
});
