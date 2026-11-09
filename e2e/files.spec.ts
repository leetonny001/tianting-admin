// FE-639：元数据页、正文页配合图片和文件消息（PRD-chat 第 14.1 节，AC-ADM-30-7 的 C2 扩展）。
// 真实 console-server + im-server（IM_FILES_ENABLED=1，假 S3）+ Postgres；页面是生产构建，响应头是生产 CSP。
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { freshOtp, imGroup, imUsers, login, provision, REASON, uid, watchPage } from './helpers';

const state = () =>
  JSON.parse(readFileSync(new URL('./.state.json', import.meta.url), 'utf8')) as {
    imAdmin: string;
    ws: string;
    s3: string;
    legacy: string;
  };

let ip = 0;
async function v1(token: string, path: string, body: unknown) {
  ip += 1;
  const r = await fetch(`http://${state().ws}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': `203.0.${113 + Math.floor(ip / 250)}.${1 + (ip % 250)}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

type Put = { url: string; headers: Record<string, string> };
async function put(p: Put, data: Buffer) {
  const headers = Object.fromEntries(Object.entries(p.headers).filter(([k]) => !/^(content-length|host)$/i.test(k)));
  const r = await fetch(p.url, { method: 'PUT', headers, body: data as BodyInit });
  if (!r.ok) throw new Error(`put ${r.status}`);
}

/** 最小的 PNG（不透明 RGB）。 */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 90);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function token(userId: string) {
  const s = state();
  const r = await fetch(`${s.imAdmin}/admin/users/token`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return ((await r.json()) as { token: string }).token;
}

async function upload(tok: string, kind: 'image' | 'file', name: string, data: Buffer, mime: string, thumb?: Buffer) {
  const up = (await v1(tok, '/v1/files/uploads', {
    kind,
    name,
    size: data.length,
    mime,
    ...(thumb ? { thumb: { size: thumb.length, mime: 'image/png' } } : {}),
  })) as { fileId: string; put: Put; thumbPut?: Put };
  await put(up.put, data);
  if (thumb && up.thumbPut) await put(up.thumbPut, thumb);
  await v1(tok, `/v1/files/${up.fileId}/complete`, {});
  return up.fileId;
}

/** 用 WebSocket 发一条图片或文件消息。 */
async function sendAttachment(tok: string, groupId: string, type: 'image' | 'file', fileId: string) {
  const ws = new WebSocket(`ws://${state().ws}/ws?platform=web`);
  await new Promise((r) => ws.addEventListener('open', r));
  const acks = new Map<string, (f: { error?: { code: number } }) => void>();
  ws.addEventListener('message', (e) => {
    const f = JSON.parse(String(e.data)) as { id?: string; cmd?: string; error?: { code: number } };
    if (f.cmd === 'ack' && f.id) acks.get(f.id)?.(f);
  });
  const call = (id: string, cmd: string, data: unknown) =>
    new Promise<{ error?: { code: number } }>((resolve) => {
      acks.set(id, resolve);
      ws.send(JSON.stringify({ id, cmd, data }));
    });
  await call('auth', 'auth', { token: tok });
  const id = `att-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const r = await call(id, 'send', {
    convType: 'group',
    to: groupId,
    type,
    clientMsgId: id,
    body: { [type]: { fileId } },
  });
  ws.close();
  if (r.error) throw new Error(`send ${r.error.code}`);
}

const MARK = 'ZXQ-FILE-ADM';

test('元数据页：图片、文件只有类型和长度，页面和接口响应都没有文件名（FE-639，AC-ADM-30-7）', async ({ page }) => {
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
    await upload(tok, 'file', `${MARK}-报告.pdf`, Buffer.from('%PDF-1.4 adm'), 'application/pdf'),
  );
  await sendAttachment(
    tok,
    g,
    'image',
    await upload(tok, 'image', `${MARK}.png`, png(64, 48), 'image/png', png(32, 24)),
  );
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
