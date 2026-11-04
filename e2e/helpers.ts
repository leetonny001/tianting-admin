import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

const statePath = new URL('./.state.json', import.meta.url);
interface State {
  origin: string;
  rootCode: string;
  imAdmin: string;
  ws: string;
  legacy: string;
  clock: number;
  accounts?: Record<string, Account>;
}
const readState = (): State => JSON.parse(readFileSync(statePath, 'utf8'));
const writeState = (s: State) => writeFileSync(statePath, JSON.stringify(s));

export const PASSWORD = 'Correct-Horse-9-Battery';
export const REASON = '工单 T-100 处理';

export interface Account {
  username: string;
  password: string;
  seed: string; // base32
  id: string;
  recovery: string[];
}

/** 同时拨 [IM 钟] 和 [C 钟]：TOTP 同一步不能用两次，每次要码都推进 31 秒。先 IM 后 console，和 tools/set-clocks.sh 一样。 */
export async function setClocks(now: number) {
  const s = readState();
  let r = await fetch(`${s.imAdmin}/admin/test/clock`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy },
    body: JSON.stringify({ nowMs: now }),
  });
  if (!r.ok) throw new Error(`im clock ${r.status}`);
  r = await fetch(`${s.origin}/console/test/clock`, { method: 'POST', body: JSON.stringify({ nowMs: now }) });
  if (!r.ok) throw new Error(`console clock ${r.status}`);
  s.clock = now;
  writeState(s);
}

export async function tick(ms = 31_000) {
  await setClocks(readState().clock + ms);
}

export const clockNow = () => readState().clock;

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of text.replace(/=+$/, '')) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(seed: string, at = readState().clock): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', base32Decode(seed)).update(counter).digest();
  const off = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** 新的动态码：先推进时钟。 */
export async function freshOtp(seed: string) {
  await tick();
  return totp(seed);
}

/** 不经过浏览器的 console 客户端：造账号和数据用。 */
export class Api {
  cookie = '';
  csrf = '';
  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const s = readState();
    const headers: Record<string, string> = { Origin: s.origin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    const r = await fetch(s.origin + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set?.startsWith('__Host-adm_sid=')) this.cookie = set.split(';')[0]!;
    const text = await r.text();
    const data = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
    if (data.csrfToken) this.csrf = data.csrfToken;
    return data as T;
  }
}

/** 激活码 → 密码 → TOTP → full 会话。 */
async function activate(username: string, code: string): Promise<{ api: Api; account: Account }> {
  const api = new Api();
  await api.call('POST', '/console/api/auth/activate', { username, code, newPassword: PASSWORD });
  const setup = await api.call<{ otpauthUri: string }>('POST', '/console/api/auth/totp/setup', {});
  const seed = new URL(setup.otpauthUri).searchParams.get('secret')!;
  const done = await api.call<{ account: { id: string }; recoveryCodes: string[] }>(
    'POST',
    '/console/api/auth/totp/confirm',
    { otp: await freshOtp(seed) },
  );
  return { api, account: { username, password: PASSWORD, seed, id: done.account.id, recovery: done.recoveryCodes } };
}

let rootApi: Api | null = null;

/** 超管会话（node 里）：账号在 state 里，跨测试文件复用。 */
export async function root(): Promise<Api> {
  if (rootApi) return rootApi;
  const s = readState();
  if (!s.accounts?.root1) {
    await setClocks(s.clock);
    const { api, account } = await activate('root1', s.rootCode);
    const next = readState();
    next.accounts = { ...next.accounts, root1: account };
    writeState(next);
    rootApi = api;
    return api;
  }
  rootApi = await loginApi(s.accounts.root1);
  return rootApi;
}

export async function loginApi(a: Account): Promise<Api> {
  const api = new Api();
  await api.call('POST', '/console/api/auth/login', {
    username: a.username,
    password: a.password,
    otp: await freshOtp(a.seed),
  });
  return api;
}

export async function stepUp(api: Api, a: Account) {
  await api.call('POST', '/console/api/auth/step-up', { otp: await freshOtp(a.seed) });
}

export function rootAccount(): Account {
  return readState().accounts!.root1!;
}

/** 新建账号（名字唯一）。roles 是单角色或叠加。 */
export async function provision(prefix: string, ...roles: string[]): Promise<Account> {
  const r = await root();
  await stepUp(r, rootAccount());
  const username = `${prefix}${Math.floor(Math.random() * 1e8)}`;
  const created = await r.call<{ activationCode: string }>('POST', '/console/api/accounts', {
    username,
    displayName: username,
    roles,
  });
  const { account } = await activate(username, created.activationCode);
  return account;
}

/** 新建账号，只创建不激活（测试页面上的激活流程）。 */
export async function createPending(prefix: string, ...roles: string[]) {
  const r = await root();
  await stepUp(r, rootAccount());
  const username = `${prefix}${Math.floor(Math.random() * 1e8)}`;
  const created = await r.call<{ activationCode: string }>('POST', '/console/api/accounts', {
    username,
    displayName: username,
    roles,
  });
  return { username, code: created.activationCode };
}

/** 页面登录。 */
export async function login(page: Page, a: Account) {
  await page.goto('/login');
  await page.getByLabel('账号').fill(a.username);
  await page.getByLabel('密码').fill(a.password);
  await page.getByLabel('动态码').fill(await freshOtp(a.seed));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主菜单' })).toBeVisible();
}

/** 收集 CSP 违规和 JS 报错：每个页面用例结束时断言为空。 */
export function watchPage(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Content-Security-Policy/i.test(m.text()))
      problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  return problems;
}

/** im-server 上造数据，不经过 console。 */
export async function imUsers(users: { userId: string; nickname?: string; avatar?: string }[]) {
  const s = readState();
  const r = await fetch(`${s.imAdmin}/admin/users/import`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users }),
  });
  if (!r.ok) throw new Error(`import ${r.status} ${await r.text()}`);
}

export async function imGroup(groupId: string, name: string, members: string[]) {
  const s = readState();
  const r = await fetch(`${s.imAdmin}/admin/groups`, {
    method: 'POST',
    headers: { 'X-Admin-Key': s.legacy, 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, name, members }),
  });
  if (!r.ok) throw new Error(`group ${r.status} ${await r.text()}`);
}

export async function setFault(auditWrite: string) {
  const s = readState();
  const r = await fetch(`${s.origin}/console/test/faults`, { method: 'POST', body: JSON.stringify({ auditWrite }) });
  if (!r.ok) throw new Error(`faults ${r.status}`);
}

export const uid = (p: string) => `${p}${Math.floor(Math.random() * 1e8)}`;
