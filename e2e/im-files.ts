// 造聊天数据（不经过 console）：上传图片和文件、用 WebSocket 发消息、撤回。files.spec.ts（FE-639）和
// recall.spec.ts（FE-671）共用。凭证都是 e2e/stack.mjs 的测试值。
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const imState = () =>
  JSON.parse(readFileSync(new URL('./.state.json', import.meta.url), 'utf8')) as {
    imAdmin: string;
    ws: string;
    s3: string;
    legacy: string;
  };

let ip = 0;
async function v1(token: string, path: string, body: unknown) {
  ip += 1;
  const r = await fetch(`http://${imState().ws}${path}`, {
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
export function png(w: number, h: number, fill = 90): Buffer {
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
  const raw = Buffer.alloc((w * 3 + 1) * h, fill);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function token(userId: string) {
  const s = imState();
  const r = await fetch(`${s.imAdmin}/admin/users/token`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return ((await r.json()) as { token: string }).token;
}

export async function upload(
  tok: string,
  kind: 'image' | 'file',
  name: string,
  data: Buffer,
  mime: string,
  thumb?: Buffer,
) {
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

type Ack = { error?: { code: number }; data?: { msgId?: string; seq?: number; reportId?: string } };

/** 一条已登录的 WebSocket 连接：发消息（返回 msgId）、撤回。 */
export async function imConn(tok: string) {
  const ws = new WebSocket(`ws://${imState().ws}/ws?platform=web`);
  await new Promise((r) => ws.addEventListener('open', r));
  const acks = new Map<string, (f: Ack) => void>();
  ws.addEventListener('message', (e) => {
    const f = JSON.parse(String(e.data)) as Ack & { id?: string; cmd?: string };
    if (f.cmd === 'ack' && f.id) acks.get(f.id)?.(f);
  });
  let n = 0;
  const call = (cmd: string, data: unknown) =>
    new Promise<Ack>((resolve) => {
      const id = `${cmd}-${Date.now()}-${++n}-${Math.floor(Math.random() * 1e6)}`;
      acks.set(id, resolve);
      ws.send(JSON.stringify({ id, cmd, data: cmd === 'send' ? { ...(data as object), clientMsgId: id } : data }));
    });
  const auth = await call('auth', { token: tok });
  if (auth.error) throw new Error(`auth ${auth.error.code}`);
  return {
    async send(groupId: string, type: string, body: Record<string, unknown>): Promise<string> {
      const r = await call('send', { convType: 'group', to: groupId, type, body });
      if (r.error || !r.data?.msgId) throw new Error(`send ${r.error?.code}`);
      return r.data.msgId;
    },
    async recall(convId: string, msgId: string) {
      const r = await call('recall', { convId, msgId });
      if (r.error) throw new Error(`recall ${r.error.code}`);
    },
    /** 发到群或单聊，返回 msgId 和 seq；被拒绝时返回错误码（C6：命中词库是 4510）。 */
    async post(convType: 'group' | 'c2c', to: string, type: string, body: Record<string, unknown>) {
      const r = await call('send', { convType, to, type, body });
      return { code: r.error?.code ?? 0, msgId: r.data?.msgId ?? '', seq: r.data?.seq ?? 0 };
    },
    /** 标记已读（举报撤回的消息要 readSeq ≥ seq，PRD-chat F-MOD-03 规则 2a）。 */
    async read(convId: string, seq: number) {
      const r = await call('read', { convId, seq });
      if (r.error) throw new Error(`read ${r.error.code}`);
    },
    /** 举报（PRD-chat F-MOD-03 规则 1），返回 reportId。 */
    async report(data: Record<string, unknown>): Promise<string> {
      const r = await call('report', data);
      if (r.error || !r.data?.reportId) throw new Error(`report ${r.error?.code}`);
      return r.data.reportId;
    },
    close: () => ws.close(),
  };
}

/** 用 WebSocket 发一条图片或文件消息。 */
export async function sendAttachment(tok: string, groupId: string, type: 'image' | 'file', fileId: string) {
  const c = await imConn(tok);
  try {
    return await c.send(groupId, type, { [type]: { fileId } });
  } finally {
    c.close();
  }
}
