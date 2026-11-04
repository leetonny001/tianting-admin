import { readFileSync } from 'node:fs';
import { tick } from './helpers';

const state = () => JSON.parse(readFileSync(new URL('./.state.json', import.meta.url), 'utf8'));

/** 真实的客户端连接（Node 22 自带 WebSocket）：验证后台操作真的到了用户那边。 */
export async function dialIM(userId: string, platform: string) {
  const s = state();
  const r = await fetch(`${s.imAdmin}/admin/users/token`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const { token } = (await r.json()) as { token: string };
  const ws = new WebSocket(`ws://${s.ws}/ws?platform=${platform}`);
  const events: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener('message', (e) => {
    const f = JSON.parse(String(e.data));
    if (f.cmd === 'event') {
      events.push(f.data);
      waiters.splice(0).forEach((w) => w());
    }
    if (f.id === 'auth') waiters.splice(0).forEach((w) => w());
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => {
      waiters.push(resolve);
      ws.send(JSON.stringify({ id: 'auth', cmd: 'auth', data: { token } }));
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
  const waitEvent = async (type: string) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const found = events.find((e) => e.type === type);
      if (found) return found as { type: string; reason?: string };
      if (Date.now() > deadline) throw new Error(`no ${type} event`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 200);
      });
    }
  };
  return { waitEvent, kicked: () => waitEvent('kicked'), close: () => ws.close() };
}

export async function imSend(userId: string, groupId: string, count: number) {
  const s = state();
  const r = await fetch(`${s.imAdmin}/admin/users/token`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const { token } = (await r.json()) as { token: string };
  const ws = new WebSocket(`ws://${s.ws}/ws?platform=web`);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  const pending = new Map<string, () => void>();
  let retry: ((id: string) => void) | null = null;
  ws.addEventListener('message', (e) => {
    const f = JSON.parse(String(e.data));
    if (f.cmd !== 'ack') return;
    if (f.error?.code === 4290) {
      retry?.(f.id);
      return;
    }
    pending.get(f.id)?.();
  });
  await new Promise<void>((resolve) => {
    pending.set('auth', resolve);
    ws.send(JSON.stringify({ id: 'auth', cmd: 'auth', data: { token } }));
  });
  for (let i = 0; i < count; i++) {
    const id = `${userId}-${i}`;
    const send = () =>
      ws.send(
        JSON.stringify({
          id,
          cmd: 'send',
          data: { convType: 'group', to: groupId, type: 'text', clientMsgId: id, body: { text: 'ZXQ-BODY-123' } },
        }),
      );
    await new Promise<void>((resolve) => {
      pending.set(id, resolve);
      // 发送限流的令牌桶按 [IM 钟] 补充，而钟是冻结的：推进一下再发。
      retry = () => void tick(2000).then(send);
      send();
    });
  }
  ws.close();
}
