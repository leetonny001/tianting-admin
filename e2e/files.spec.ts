// FE-639：元数据页、正文页配合图片和文件消息（PRD-chat 第 14.1 节，AC-ADM-30-7 的 C2 扩展）。
// 真实 console-server + im-server（IM_FILES_ENABLED=1，假 S3）+ Postgres；页面是生产构建，响应头是生产 CSP。
import { expect, test } from '@playwright/test';
import { freshOtp, imGroup, imUsers, login, provision, REASON, uid, watchPage } from './helpers';
import { imState as state, png, sendAttachment, token, upload } from './im-files';

const MARK = 'ZXQ-FILE-ADM';

test('元数据页：图片、文件只有类型和大小（v1.4 取 fileSize），页面和接口响应都没有文件名（FE-639，AC-ADM-30-7）', async ({
  page,
}) => {
  const problems = watchPage(page);
  const u = uid('fu');
  const g = uid('fg');
  await imUsers([{ userId: u }]);
  await imGroup(g, 'n', [u]);
  const tok = await token(u);
  // 1.2 MB 的文件（1 258 291 字节）：元数据页的"大小"显示原文件大小（PRD-chat v1.4 第 14.1 节，P-37 ③）。
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4 adm'), Buffer.alloc(1_258_291 - 12, 1)]);
  const photo = png(64, 48);
  await sendAttachment(tok, g, 'file', await upload(tok, 'file', `${MARK}-报告.pdf`, pdf, 'application/pdf'));
  await sendAttachment(tok, g, 'image', await upload(tok, 'image', `${MARK}.png`, photo, 'image/png', png(32, 24)));
  const kf = await provision('kf', 'support');
  await login(page, kf);
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/console/api/')) bodies.push(await r.text().catch(() => ''));
  });
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${g}`);
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByRole('row')).toHaveCount(3);
  const types = await page.getByRole('row').evaluateAll((rows) => rows.slice(1).map((r) => r.children[3]!.textContent));
  expect(types).toEqual(['图片', '文件']);
  const sizes = await page.getByRole('row').evaluateAll((rows) => rows.slice(1).map((r) => r.children[4]!.textContent));
  expect(sizes).toEqual([
    photo.length < 1024 ? `${photo.length} B` : `${Math.round(photo.length / 102.4) / 10} KB`,
    '1.2 MB',
  ]);
  const metaBodies = bodies.filter((b) => b.includes('"bodyLength"'));
  expect(metaBodies.join('\n')).toContain(`"fileSize":${pdf.length}`);
  await expect(page.locator('body')).not.toContainText(MARK);
  expect(bodies.join('\n')).not.toContain(MARK);
  expect(problems).toEqual([]);
});

test('正文页：凭授权显示文件名和大小，写明不可预览；不请求文件，不内联渲染，没有 CSP 违规（FE-639）', async ({
  page,
}) => {
  const problems = watchPage(page);
  const u = uid('fu');
  const g = uid('fg');
  await imUsers([{ userId: u }]);
  await imGroup(g, 'n', [u]);
  const tok = await token(u);
  await sendAttachment(
    tok,
    g,
    'file',
    await upload(tok, 'file', `${MARK}-<b>报告.pdf`, Buffer.alloc(4096, 1), 'application/pdf'),
  );
  await sendAttachment(tok, g, 'image', await upload(tok, 'image', 'x.png', png(64, 48), 'image/png', png(32, 24)));
  const storage: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(state().s3)) storage.push(r.url());
  });
  const mod = await provision('md', 'moderator');
  await login(page, mod);
  await page.goto('/messages');
  await page.getByLabel('会话 ID').fill(`group:${g}`);
  await page.getByRole('button', { name: '查询' }).click();
  await page.getByRole('button', { name: '查看正文' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('工单号').fill('T-639');
  await page.getByLabel('理由').fill(REASON);
  await page.getByLabel('动态码').fill(await freshOtp(mod.seed));
  await page.getByRole('dialog').getByRole('button', { name: '查看' }).click();
  await expect(page.getByText(`[文件] ${MARK}-<b>报告.pdf，4 KB（不可预览）`)).toBeVisible();
  await expect(page.getByText(/^\[图片\] 64×48，\d+ B（不可预览）$/)).toBeVisible();
  expect(await page.locator('.body-area img, .body-area b, .body-area a[href]').count()).toBe(0);
  expect(storage).toEqual([]);
  expect(problems).toEqual([]);
});
