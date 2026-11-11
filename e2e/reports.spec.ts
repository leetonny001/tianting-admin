// FE-697：举报队列、详情、证据、结案（PRD-chat F-MOD-04，第 14.1 节；AC-MOD-03-1、03-11、04-6、04-12、04-15，P-48 ①⑤）。
// 真实 console-server（CS-207、CS-208）+ im-server（IM_MOD_ENABLED=1、IM_MSG_ACTIONS_ENABLED=1、IM_FILES_ENABLED=1，
// IM_C2C_BODY_ACCESS 默认 off，假 S3）+ Postgres；页面是生产构建，响应头是生产 CSP。只用特征串 ZXQ-*。
// AC-MOD-04-1 的完整流程（读证据 → 删除消息 → 结案，审计顺序）随 FE-698。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Api, freshOtp, imGroup, imUsers, login, loginApi, provision, uid, watchPage, type Account } from './helpers';
import { imConn, png, token, upload } from './im-files';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const REASON = '核实举报内容';

interface World {
  a: string;
  b: string;
  g: string;
  tag: string;
  secret: string;
  note: string;
  fileName: string;
  photo: Buffer;
  thumb: Buffer;
  pdf: Buffer;
  rText: string;
  rImage: string;
  rFile: string;
  rC2c: string;
}

let w: World;
let mod: Account;

/** 群 g：a 发文字（之后撤回）、图片、文件；b、c、d 都举报 a；b 举报这三条消息和 a 发给他的一条单聊。 */
test.beforeAll(async () => {
  const tag = uid('');
  const a = uid('ra');
  const b = uid('rb');
  const c = uid('rc');
  const d = uid('rd');
  const g = uid('rg');
  const secret = `ZXQ-RPT-${tag}`;
  const note = `ZXQ-NOTE-${tag} <i>补充</i>`;
  const fileName = `<script>alert(1)</script>ZXQ-FN-${tag}.pdf`;
  await imUsers([{ userId: a }, { userId: b }, { userId: c }, { userId: d }]);
  await imGroup(g, 'n', [a, b, c, d]);
  const conv = `group:${g}`;
  const ta = await token(a);
  const photo = png(64, 48, 40);
  const thumb = png(16, 12, 200);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4 rpt '), Buffer.alloc(4000, 3)]);
  const imageId = await upload(ta, 'image', `ZXQ-IMG-${tag}.png`, photo, 'image/png', thumb);
  const fileId = await upload(ta, 'file', fileName, pdf, 'application/pdf');
  const ca = await imConn(ta);
  const text = await ca.post('group', g, 'text', { text: `${secret} 原话` });
  const image = await ca.post('group', g, 'image', { image: { fileId: imageId } });
  const file = await ca.post('group', g, 'file', { file: { fileId } });
  const dm = await ca.post('c2c', b, 'text', { text: `${secret} 单聊` });
  for (const m of [text, image, file, dm]) if (m.code) throw new Error(`send ${m.code}`);
  const cb = await imConn(await token(b));
  await cb.read(conv, file.seq);
  const c2c = a < b ? `c2c:${a}:${b}` : `c2c:${b}:${a}`;
  await cb.read(c2c, dm.seq);
  // 看过之后被撤回，再从撤回提示行举报（AC-MOD-03-11）：隔离原文进证据。
  await ca.recall(conv, text.msgId);
  const rText = await cb.report({ targetType: 'message', convId: conv, msgIds: [text.msgId], reason: 'abuse', note });
  const rImage = await cb.report({ targetType: 'message', convId: conv, msgIds: [image.msgId], reason: 'porn' });
  const rFile = await cb.report({ targetType: 'message', convId: conv, msgIds: [file.msgId], reason: 'fraud' });
  const rC2c = await cb.report({ targetType: 'message', convId: c2c, msgIds: [dm.msgId], reason: 'spam' });
  // 同一用户被 3 人举报（AC-MOD-04-6，backend-chat 第 117 条）。
  await cb.report({ targetType: 'user', userId: a, reason: 'abuse' });
  for (const u of [c, d]) {
    const cu = await imConn(await token(u));
    await cu.report({ targetType: 'user', userId: a, reason: u === c ? 'spam' : 'other' });
    cu.close();
  }
  ca.close();
  cb.close();
  w = { a, b, g, tag, secret, note, fileName, photo, thumb, pdf, rText, rImage, rFile, rC2c };
  mod = await provision('rm', 'moderator');
});

/** 在队列里找到对象那一行，点开，进其中一条举报单。 */
async function openFromQueue(page: Page, target: string | RegExp, reportId: string) {
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '举报' }).click();
  const rows = page.getByRole('table', { name: '举报队列' }).getByRole('row').filter({ hasText: target });
  await expect(rows.first()).toBeVisible();
  // 同类对象可能有好几行（单聊消息没有会话 ID）：都点开，再按举报 ID 进。
  const closed = rows.getByRole('button', { name: '查看每条' });
  for (let n = await closed.count(); n > 0; n--) {
    await closed.first().click();
    await expect(closed).toHaveCount(n - 1);
  }
  await rows.getByRole('link', { name: reportId, exact: true }).click();
}

async function grant(page: Page, a: Account, reportId: string) {
  await page.getByRole('button', { name: '查看证据' }).click();
  const dlg = page.getByRole('dialog', { name: '查看举报证据' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('工单号')).toHaveValue(reportId);
  await expect(dlg.getByLabel('工单号')).toHaveAttribute('readonly', '');
  await dlg.getByLabel('理由').fill(REASON);
  await dlg.getByLabel('动态码').fill(await freshOtp(a.seed));
  await dlg.getByRole('button', { name: '查看' }).click();
  await expect(dlg).toHaveCount(0);
}

/** 生产 CSP 下的违规（AC-MOD-04-12）：securitypolicyviolation 事件，CDP 注入，不受页面 CSP 影响。 */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
    (window as unknown as { __csp: string[] }).__csp = seen;
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('AC-MOD-04-6 AC-MOD-03-1 队列：同一用户被 3 人举报聚合显示"3 次"，点开看到每条；只有审核员有举报菜单', async ({
  page,
}) => {
  const problems = watchPage(page);
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/console/api/reports')) bodies.push(await r.text().catch(() => ''));
  });
  await login(page, mod);
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '举报' }).click();
  await expect(page.getByLabel('状态')).toHaveValue('pending');
  const table = page.getByRole('table', { name: '举报队列' });
  const userRow = table.getByRole('row').filter({ hasText: `用户 ${w.a}` });
  await expect(userRow).toContainText('3 次');
  await userRow.getByRole('button', { name: '查看每条' }).click();
  const each = userRow.getByRole('list', { name: '每条举报' }).getByRole('listitem');
  await expect(each).toHaveCount(3);
  await expect(each.filter({ hasText: '辱骂骚扰 · 待处理' })).toHaveCount(1);
  await expect(each.filter({ hasText: '垃圾广告 · 待处理' })).toHaveCount(1);
  await expect(each.filter({ hasText: '其他 · 待处理' })).toHaveCount(1);
  // 群消息带会话和 msgId；单聊消息不带（打开时填理由）。
  await expect(table.getByRole('row').filter({ hasText: `群消息 group:${w.g}` })).toHaveCount(3);
  await expect(table.getByRole('row').filter({ hasText: '单聊消息（打开时填写理由）' }).first()).toBeVisible();
  // 队列里没有正文、note、文件名。
  const all = bodies.join('\n');
  expect(all).not.toContain(w.secret);
  expect(all).not.toContain('ZXQ-NOTE');
  expect(all).not.toContain('ZXQ-FN');

  // 筛选：理由"色情低俗"只剩图片那条。
  await page.getByLabel('理由').selectOption({ label: '色情低俗' });
  await page.getByRole('button', { name: '筛选' }).click();
  await expect(table.getByRole('row').filter({ hasText: `用户 ${w.a}` })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: `群消息 group:${w.g}` })).toHaveCount(1);
  await expect(table.getByRole('row').filter({ hasText: '单聊消息' })).toHaveCount(0);

  for (const role of ['support', 'operator']) {
    const other = await provision('rx', role);
    await page.context().clearCookies();
    await login(page, other);
    await expect(page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '举报' })).toHaveCount(0);
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: '无权限' })).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('AC-MOD-03-11 群消息举报：POST 打开，元数据没有 note；授权（理由 + 当次动态码）后看隔离原文、补充说明和平铺水印', async ({
  page,
}) => {
  const problems = watchPage(page);
  const requests: { method: string; url: string; body: string }[] = [];
  const bodies: string[] = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));
  page.on('response', async (r) => {
    if (r.url().includes('/console/api/reports/')) bodies.push(`${r.url()} ${await r.text().catch(() => '')}`);
  });
  await login(page, mod);
  await openFromQueue(page, `群消息 group:${w.g}`, w.rText);
  await expect(page.getByRole('heading', { name: `举报单 ${w.rText}` })).toBeVisible();
  const kv = page.locator('dl.kv');
  await expect(kv).toContainText(`举报人${w.b}`);
  await expect(kv).toContainText(`被举报人${w.a}`);
  await expect(kv).toContainText('该用户被举报的总次数');
  await expect(kv).toContainText('理由辱骂骚扰');
  const opens = requests.filter((r) => r.url.includes(`/reports/${w.rText}`));
  expect(opens.map((r) => `${r.method} ${r.url.replace(/^.*\/console\/api/, '')}`)).toEqual([
    `POST /reports/${w.rText}/view`,
  ]);
  // 元数据（授权前）：没有 note、正文。
  await expect(page.locator('body')).not.toContainText('ZXQ-NOTE');
  await expect(page.locator('body')).not.toContainText(w.secret);
  expect(bodies.join('\n')).not.toContain('ZXQ-NOTE');

  // 命中统计入口（backend-chat 第 121 条）：查的是被举报人，点了才查。
  const hitsUrls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/moderation/hits')) hitsUrls.push(r.url().replace(/^.*\/console\/api/, ''));
  });
  const hitsPanel = page.getByRole('heading', { name: '命中统计' }).locator('..');
  await expect(hitsPanel).toContainText(`被举报人 ${w.a} 命中词库的次数`);
  expect(hitsUrls).toEqual([]);
  await hitsPanel.getByRole('button', { name: '查询次数' }).click();
  await expect(hitsPanel).toContainText('没有命中记录');
  expect(hitsUrls).toEqual([`/moderation/hits?userId=${w.a}`]);

  await grant(page, mod, w.rText);
  await expect(page.getByText(`${w.secret} 原话`)).toBeVisible();
  await expect(page.getByText(new RegExp(`^已撤回（${w.a}，.+），以下是隔离原文$`))).toBeVisible();
  await expect(page.getByText(`补充说明：${w.note}`, { exact: true })).toBeVisible();
  expect(await page.locator('.body-area i').count()).toBe(0);
  const wm = page.getByTestId('watermark');
  const prefix = JSON.parse(
    bodies
      .find((b) => b.includes('/evidence-grant '))!
      .split(' ')
      .slice(1)
      .join(' '),
  ).grantPrefix;
  expect(prefix).toMatch(/^.{8}$/);
  await expect(wm.locator('span').first()).toHaveText(
    new RegExp(`^${mod.username} \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} ${prefix}$`),
  );
  expect(await wm.locator('span').count()).toBeGreaterThan(10);
  // 授权的请求体只有理由和动态码，工单号由 console 用举报 ID；理由不进 URL。
  const grantReq = requests.find((r) => r.url.endsWith(`/reports/${w.rText}/evidence-grant`))!;
  expect(Object.keys(JSON.parse(grantReq.body)).sort()).toEqual(['otp', 'reason']);
  for (const r of requests) expect(decodeURIComponent(r.url)).not.toContain(REASON);
  expect(problems).toEqual([]);
});

test('AC-MOD-04-12 AC-MOD-04-15 图片缩略图和原图经 console 同源加载（data:），文件只能下载，文件名含 <script> 按纯文本；生产 CSP 没有违规', async ({
  page,
}) => {
  const problems = watchPage(page);
  const csp = await watchCsp(page);
  const fetches: { url: string; body: string; type: string; disposition: string; nosniff: string }[] = [];
  let pageCsp = '';
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'document') pageCsp = r.headers()['content-security-policy'] ?? '';
    if (r.url().includes('/files/') && r.url().endsWith('/fetch'))
      fetches.push({
        url: r.url().replace(/^.*\/console\/api/, ''),
        body: r.request().postData() ?? '',
        type: r.headers()['content-type'] ?? '',
        disposition: r.headers()['content-disposition'] ?? '',
        nosniff: r.headers()['x-content-type-options'] ?? '',
      });
  });
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await login(page, mod);

  // 图片：缩略图和原图都显示，src 是 data:，字节和上传的一致。
  await page.goto(`/reports/${w.rImage}`);
  await expect(page.locator('dl.kv')).toContainText('理由色情低俗');
  await grant(page, mod, w.rImage);
  const thumb = page.getByRole('img', { name: '缩略图' });
  const orig = page.getByRole('img', { name: '原图' });
  await expect(thumb).toBeVisible();
  await expect(orig).toBeVisible();
  const decoded = async (img: typeof thumb) => {
    const src = (await img.getAttribute('src'))!;
    expect(src).toMatch(/^data:image\/png;base64,/);
    return Buffer.from(src.split(',')[1]!, 'base64');
  };
  expect(sha(await decoded(thumb))).toBe(sha(w.thumb));
  expect(sha(await decoded(orig))).toBe(sha(w.photo));
  await expect.poll(() => orig.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(64);
  const byVariant = [...fetches].sort((x, y) => JSON.parse(y.body).variant.localeCompare(JSON.parse(x.body).variant));
  expect(byVariant.map((f) => [f.url, JSON.parse(f.body).variant, f.type, f.disposition, f.nosniff])).toEqual([
    [
      expect.stringMatching(new RegExp(`^/reports/${w.rImage}/files/[^/]+/fetch$`)),
      'thumb',
      'image/png',
      'inline',
      'nosniff',
    ],
    [
      expect.stringMatching(new RegExp(`^/reports/${w.rImage}/files/[^/]+/fetch$`)),
      'original',
      'image/png',
      'inline',
      'nosniff',
    ],
  ]);
  // 后台 CSP 没有放宽：img-src 只有 'self' data:，没有 blob:。
  expect(pageCsp).toContain("img-src 'self' data:;");
  expect(pageCsp).not.toContain('blob:');

  // 文件：只有"下载"（attachment），不内联；文件名按纯文本（im-server 清洗掉了 "/"）。
  fetches.length = 0;
  await page.goto(`/reports/${w.rFile}`);
  await grant(page, mod, w.rFile);
  const shown = w.fileName.replace(/\//g, '');
  await expect(page.getByText(`[文件] ${shown}，`, { exact: false })).toBeVisible();
  expect(
    await page
      .locator('.body-area img, .body-area iframe, .body-area object, .body-area embed, .body-area script')
      .count(),
  ).toBe(0);
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载' }).click();
  const dl = await wait;
  // 浏览器另存时把 < > 换成 _，页面给的名字就是证据里的文件名。
  expect(dl.suggestedFilename()).toContain('alert(1)');
  expect(dl.suggestedFilename().endsWith(`ZXQ-FN-${w.tag}.pdf`)).toBe(true);
  expect(sha(readFileSync((await dl.path())!))).toBe(sha(w.pdf));
  expect(fetches.map((f) => [f.type, f.disposition, f.nosniff])).toEqual([
    ['application/pdf', 'attachment', 'nosniff'],
  ]);
  for (const u of urls) {
    expect(decodeURIComponent(u)).not.toContain('ZXQ-FN');
  }
  expect(await csp()).toEqual([]);
  expect(problems).toEqual([]);
});

test('单聊消息举报（P-48 ①⑤）：先填理由才打开，理由在请求体；证据显示"单聊正文查看未开启"，只能看元数据和被举报次数', async ({
  page,
}) => {
  const problems = watchPage(page);
  const requests: { method: string; url: string; body: string }[] = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));
  await login(page, mod);
  await openFromQueue(page, '单聊消息（打开时填写理由）', w.rC2c);
  const ask = page.getByRole('dialog', { name: '查看单聊举报' });
  await expect(ask).toContainText('每天 50 个会话');
  expect(requests.filter((r) => r.url.includes(`/reports/${w.rC2c}`))).toEqual([]);
  await ask.getByLabel('理由').fill(REASON);
  await ask.getByRole('button', { name: '查看' }).click();
  await expect(page.locator('dl.kv')).toContainText(`举报人${w.b}`);
  await expect(page.locator('dl.kv')).toContainText('该用户被举报的总次数');
  await expect(page.locator('dl.kv')).toContainText('单聊消息 c2c:');
  const view = requests.find((r) => r.url.endsWith(`/reports/${w.rC2c}/view`))!;
  expect(view.method).toBe('POST');
  expect(JSON.parse(view.body)).toEqual({ reason: REASON });
  await grant(page, mod, w.rC2c);
  await expect(page.getByText('单聊正文查看未开启')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看证据' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(w.secret);
  for (const r of requests) expect(decodeURIComponent(r.url)).not.toContain(REASON);
  expect(problems).toEqual([]);
});

test('结案：别人先结案时提示"举报已被处理"并刷新（AC-MOD-04-5 页面部分）；处置只是链接，不自动执行', async ({
  page,
}) => {
  const problems = watchPage(page);
  const other = await provision('ro', 'moderator');
  await login(page, mod);
  await page.goto(`/reports/${w.rImage}`);
  await expect(page.locator('dl.kv')).toContainText('状态待处理');
  const links = page.getByRole('list', { name: '处置' }).getByRole('link');
  await expect(links).toHaveText(['删除消息', '禁言', '封禁', '强制下线', '解散群']);
  await expect(links.nth(1)).toHaveAttribute('href', `/users/${w.a}`);
  await expect(links.nth(4)).toHaveAttribute('href', `/groups/${w.g}`);

  // 另一个审核员先驳回。
  const api: Api = await loginApi(other);
  await api.call('POST', `/console/api/reports/${w.rImage}/resolve`, {
    result: 'rejected',
    reason: '另一位审核员驳回',
  });

  await page.getByRole('button', { name: '已处理' }).click();
  const dlg = page.getByRole('dialog', { name: '结案：已处理' });
  await dlg.getByLabel('理由').fill('已核实违规');
  await dlg.getByRole('button', { name: '已处理' }).click();
  await expect(page.getByText('举报已被处理')).toBeVisible();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('dl.kv')).toContainText('状态已驳回');
  await expect(page.locator('dl.kv')).toContainText('另一位审核员驳回');
  await expect(page.getByRole('heading', { name: '结案' })).toHaveCount(0);

  // 自己结案另一条：成功后状态变成已处理。
  await page.goto(`/reports/${w.rFile}`);
  await page.getByRole('button', { name: '驳回' }).click();
  const d2 = page.getByRole('dialog', { name: '结案：驳回' });
  await d2.getByLabel('理由').fill('文件内容不违规');
  await d2.getByRole('button', { name: '驳回' }).click();
  await expect(page.getByText('已结案')).toBeVisible();
  await expect(page.locator('dl.kv')).toContainText('状态已驳回');
  await expect(page.locator('dl.kv')).toContainText('文件内容不违规');

  // 队列默认只看待处理：结案的两条（图片、文件）不在；切到"全部"后出现。
  await page.getByRole('link', { name: '返回队列' }).click();
  await expect(page.getByLabel('状态')).toHaveValue('pending');
  const table = page.getByRole('table', { name: '举报队列' });
  await expect(table.getByRole('row').filter({ hasText: `用户 ${w.a}` })).toHaveCount(1);
  await expect(table.getByRole('row').filter({ hasText: `群消息 group:${w.g}` })).toHaveCount(1);
  await page.getByLabel('状态').selectOption({ label: '全部' });
  await page.getByRole('button', { name: '筛选' }).click();
  await expect(table.getByRole('row').filter({ hasText: `群消息 group:${w.g}` })).toHaveCount(3);
  expect(problems).toEqual([]);
});
