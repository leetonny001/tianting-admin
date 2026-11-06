import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClient } from '../api/client';
import { inviteErrorText } from '../api/errors';
import { App } from '../App';
import { SessionProvider } from '../session';
import type { InviteRow, UserRow } from '../api/types';
import { toLocalInput } from '../lib/format';
import { checkInviteForm, inviteCreator, inviteStatus } from '../lib/invites';

// FE-619（AC-ACC-09-1 的页面部分、AC-ACC-09-11）。用真实的路由守卫、菜单、SessionProvider 和 API 客户端，只换 fetch。

const CODE = 'PLAINTEXT-INVITE-CODE-AbCd';
const LIST = '/console/api/invites';

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply[]>;
let calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];

const row = (over: Partial<InviteRow> = {}): InviteRow => ({
  inviteId: 'inv1',
  codeLast4: 'AbCd',
  maxUses: 2,
  usedCount: 0,
  expiresAt: Date.now() + 86_400_000,
  createdBy: 'console:admin:acc-9',
  createdAt: Date.now() - 1000,
  ...over,
});

function install(perms: string[]) {
  const session = {
    account: { id: 'me', username: 'op1', displayName: 'op1', space: 'admin' },
    roles: [],
    perms,
    state: 'full',
    csrfToken: 't',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (path === '/console/api/session') return new Response(JSON.stringify(session));
      if (path.endsWith('/unread-count')) return new Response(JSON.stringify({ unread: 0 }));
      const q = replies[`${method} ${path}`];
      const r = q?.length && q.length > 1 ? q.shift()! : q?.[0];
      if (!r) return new Response(JSON.stringify({ code: 4040 }), { status: 404 });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
}

const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{`${loc.pathname}${loc.search}${loc.hash} ${JSON.stringify(loc.state)}`}</div>;
}

function open(entry: string, perms = ['account.invite', 'user.read']) {
  install(perms);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <App />
        <Where />
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function fillAndGenerate(user: ReturnType<typeof userEvent.setup>, count = '1') {
  await user.click(await screen.findByRole('button', { name: '生成邀请码' }));
  const dlg = screen.getByRole('dialog', { name: '生成邀请码' });
  const countInput = within(dlg).getByLabelText('数量');
  await user.clear(countInput);
  await user.type(countInput, count);
  await user.click(within(dlg).getByRole('button', { name: '生成' }));
  return dlg;
}

beforeEach(() => {
  replies = { [`GET ${LIST}`]: [{ body: { invites: [] } }] };
  calls = [];
  resetClient();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TC-ACC-09-04 菜单和路由守卫', () => {
  it('有 account.invite：菜单有邀请码，路由能进', async () => {
    open('/invites');
    expect(await screen.findByRole('heading', { name: '邀请码' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '主菜单' })).getByRole('link', { name: '邀请码' }),
    ).toHaveAttribute('href', '/invites');
    await waitFor(() => expect(calls.some((c) => c.path === LIST)).toBe(true));
  });

  it('没有 account.invite（超管、客服）：菜单没有，直接打开路由是无权限页，不发列表请求', async () => {
    open('/invites', ['user.read', 'admin.manage', 'audit.read']);
    expect(await screen.findByRole('heading', { name: '无权限' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '主菜单' });
    expect(within(nav).getByRole('link', { name: '用户' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: '邀请码' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '邀请码' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith(LIST))).toBe(false);
  });
});

describe('TC-ACC-09-01 状态计算（列表显示已用次数和状态）', () => {
  const now = 1_000_000;
  const base = row({ expiresAt: now + 1, usedCount: 0, maxUses: 2 });
  it.each<[string, Partial<InviteRow>, string]>([
    ['可用', {}, 'active'],
    ['差一次用完仍可用', { usedCount: 1 }, 'active'],
    ['用完', { usedCount: 2 }, 'usedUp'],
    ['超用也算用完', { usedCount: 3 }, 'usedUp'],
    ['正好到期算过期（和 im-server 的 expires_at > now 一致）', { expiresAt: now }, 'expired'],
    ['过期', { expiresAt: now - 1 }, 'expired'],
    ['手动停用优先于过期和用完', { disabledAt: 5, expiresAt: now - 1, usedCount: 2 }, 'disabled'],
    ['自动停用', { disabledAt: 5, autoDisabled: true }, 'autoDisabled'],
    ['自动停用优先于过期', { disabledAt: 5, autoDisabled: true, expiresAt: now - 1 }, 'autoDisabled'],
  ])('%s', (_name, over, expected) => {
    expect(inviteStatus({ ...base, ...over }, now)).toBe(expected);
  });

  it('列表：后 4 位、已用次数、到期、备注、各种状态；已停用、已用完没有停用按钮；不显示 createdBy 原文', async () => {
    replies[`GET ${LIST}`] = [
      {
        body: {
          invites: [
            row({ inviteId: 'a', codeLast4: 'AAAA', usedCount: 2, maxUses: 2, note: '<b>春季</b>' }),
            row({ inviteId: 'b', codeLast4: 'BBBB', disabledAt: 5 }),
            row({ inviteId: 'c', codeLast4: 'CCCC', disabledAt: 5, autoDisabled: true }),
            row({ inviteId: 'd', codeLast4: 'DDDD', expiresAt: Date.now() - 1000 }),
            row({ inviteId: 'e', codeLast4: 'EEEE', usedCount: 1 }),
          ],
        },
      },
    ];
    open('/invites');
    const r = (s: string) => screen.findByRole('row', { name: new RegExp(s) });
    const a = await r('AAAA');
    expect(a).toHaveTextContent('2 / 2');
    expect(a).toHaveTextContent('已用完');
    expect(a).toHaveTextContent('<b>春季</b>');
    expect(a).toHaveTextContent('管理员 acc-9');
    expect(within(a).queryByRole('button', { name: '停用' })).toBeNull();
    expect(await r('BBBB')).toHaveTextContent('已停用');
    expect(await r('BBBB')).not.toHaveTextContent('自动');
    expect(await r('CCCC')).toHaveTextContent('已停用（自动）');
    expect(await r('DDDD')).toHaveTextContent('已过期');
    const e = await r('EEEE');
    expect(e).toHaveTextContent('1 / 2');
    expect(e).toHaveTextContent('可用');
    expect(within(e).getByRole('button', { name: '停用' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('console:admin');
  });

  it('createdBy：只认 console:admin:{id}，其他不猜', () => {
    expect(inviteCreator('console:admin:a1')).toBe('管理员 a1');
    expect(inviteCreator('console:ops:a1')).toBe('—');
    expect(inviteCreator('')).toBe('—');
    expect(inviteCreator(undefined)).toBe('—');
  });

  it('正好整页时下一页是空的：列表不变，加载更多消失，不提示"还没有"', async () => {
    replies[`GET ${LIST}`] = [{ body: { invites: [row()], nextCursor: 'inv1' } }];
    replies[`GET ${LIST}?cursor=inv1`] = [{ body: { invites: [] } }];
    open('/invites');
    await screen.findByRole('row', { name: /AbCd/ });
    await userEvent.setup().click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull());
    expect(screen.getByRole('row', { name: /AbCd/ })).toBeInTheDocument();
    expect(screen.queryByText('还没有邀请码')).toBeNull();
  });
});

describe('TC-ACC-09-05 生成：范围和错误码', () => {
  const form = { count: '1', maxUses: '1', expires: '2099-01-01T00:00', note: '' };
  const now = 1_000_000;
  it.each<[string, Partial<typeof form>, boolean]>([
    ['数量 100 通过', { count: '100' }, true],
    ['数量 101 不通过', { count: '101' }, false],
    ['数量 0 不通过', { count: '0' }, false],
    ['数量小数不通过', { count: '1.5' }, false],
    ['maxUses 1000 通过', { maxUses: '1000' }, true],
    ['maxUses 1001 不通过', { maxUses: '1001' }, false],
    ['maxUses 0 不通过', { maxUses: '0' }, false],
    ['到期是过去不通过', { expires: '1960-01-01T00:00' }, false],
    ['到期为空不通过', { expires: '' }, false],
    ['备注 200 个字通过', { note: '字'.repeat(200) }, true],
    ['备注 201 个字不通过', { note: '字'.repeat(201) }, false],
    ['备注按字符不按 UTF-16：200 个 emoji 通过', { note: '😀'.repeat(200) }, true],
  ])('%s', (_name, over, ok) => {
    expect(checkInviteForm({ ...form, ...over }, now).payload !== undefined).toBe(ok);
  });

  it('到期时间的提示写明列表里显示的北京时间', async () => {
    const user = userEvent.setup();
    open('/invites');
    await user.click(await screen.findByRole('button', { name: '生成邀请码' }));
    const dlg = screen.getByRole('dialog', { name: '生成邀请码' });
    const input = within(dlg).getByLabelText('到期时间');
    fireEvent.change(input, { target: { value: toLocalInput(Date.UTC(2099, 0, 2, 4)) } });
    expect(dlg).toHaveTextContent('列表里显示为 2099/01/02 12:00:00（北京时间）');
  });

  it('前端不合法时不能提交', async () => {
    const user = userEvent.setup();
    open('/invites');
    await user.click(await screen.findByRole('button', { name: '生成邀请码' }));
    const dlg = screen.getByRole('dialog', { name: '生成邀请码' });
    const count = within(dlg).getByLabelText('数量');
    await user.clear(count);
    await user.type(count, '101');
    expect(within(dlg).getByRole('button', { name: '生成' })).toBeDisabled();
    expect(within(dlg).getByRole('alert')).toHaveTextContent('1～100');
    expect(posts(LIST)).toEqual([]);
  });

  it.each<[number, number, RegExp]>([
    [400, 4131, /单次最多生成 100 个邀请码/],
    [400, 4000, /可用次数、到期时间或备注不符合要求/],
    [503, 5031, /审计服务不可用，操作未执行/],
  ])('服务端 %i / %i：留在框里提示，可以改了再提交', async (status, code, text) => {
    const user = userEvent.setup();
    replies[`POST ${LIST}`] = [{ status, body: { code } }];
    open('/invites');
    const dlg = await fillAndGenerate(user);
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: '生成邀请码' })).toBeEnabled();
    expect(within(dlg).getByRole('button', { name: '生成' })).toBeEnabled();
    expect(inviteErrorText(new Error('x'))).toBe('出错了，请重试');
  });

  it('请求体：数量、maxUses、毫秒到期；备注为空时不带', async () => {
    const user = userEvent.setup();
    replies[`POST ${LIST}`] = [{ body: { invites: [{ ...row(), code: CODE }] } }];
    open('/invites');
    await fillAndGenerate(user, '3');
    await screen.findByText(CODE);
    const body = posts(LIST)[0]!.body!;
    expect(body).toMatchObject({ count: 3, maxUses: 1 });
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect('note' in body).toBe(false);
  });
});

describe('TC-ACC-09-01 明文只显示一次', () => {
  it('显示明文并提示复制；不写存储、URL、日志；关闭、离开后没有', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    replies[`POST ${LIST}`] = [{ body: { invites: [{ ...row(), code: CODE }] } }];
    open('/invites');
    await fillAndGenerate(user);
    const panel = await screen.findByRole('region', { name: '刚生成的邀请码' });
    expect(panel).toHaveTextContent(CODE);
    expect(panel).toHaveTextContent('明文只显示这一次');
    expect(within(panel).getByRole('button', { name: '复制' })).toBeInTheDocument();
    // 明文还没关时不能再生成，不然会顶掉没复制的明文。
    expect(screen.getByRole('button', { name: '生成邀请码' })).toBeDisabled();

    const seen = JSON.stringify({ local: { ...window.localStorage }, session: { ...window.sessionStorage } });
    expect(seen).not.toContain(CODE);
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).not.toContain(CODE);
    for (const l of logs) expect(JSON.stringify(l.mock.calls)).not.toContain(CODE);

    // 进别的页面再回来：组件已卸载，明文没有了。
    await user.click(screen.getByRole('link', { name: '用户' }));
    await user.click(screen.getByRole('link', { name: '邀请码' }));
    await screen.findByRole('heading', { name: '邀请码' });
    expect(document.body.textContent).not.toContain(CODE);
  });

  it('"我已保存，关闭"后没有明文，可以再生成', async () => {
    const user = userEvent.setup();
    replies[`POST ${LIST}`] = [{ body: { invites: [{ ...row(), code: CODE }] } }];
    open('/invites');
    await fillAndGenerate(user);
    await user.click(await screen.findByRole('button', { name: '我已保存，关闭' }));
    expect(document.body.textContent).not.toContain(CODE);
    expect(screen.getByRole('button', { name: '生成邀请码' })).toBeEnabled();
  });

  it('整页离开（pagehide）时清掉明文：浏览器往返缓存里不留', async () => {
    const user = userEvent.setup();
    replies[`POST ${LIST}`] = [{ body: { invites: [{ ...row(), code: CODE }] } }];
    open('/invites');
    await fillAndGenerate(user);
    await screen.findByText(CODE);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(document.body.textContent).not.toContain(CODE);
  });

  it('多个：每个能单独复制，也能复制全部；复制失败有提示', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (text: string) => void text);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    replies[`POST ${LIST}`] = [
      {
        body: {
          invites: [
            { ...row({ inviteId: 'a' }), code: 'CODE-A' },
            { ...row({ inviteId: 'b' }), code: 'CODE-B' },
          ],
        },
      },
    ];
    open('/invites');
    await fillAndGenerate(user, '2');
    const panel = await screen.findByRole('region', { name: '刚生成的邀请码' });
    await user.click(within(panel).getByRole('button', { name: '复制全部' }));
    expect(writeText).toHaveBeenLastCalledWith('CODE-A\nCODE-B');
    expect(within(panel).getByRole('button', { name: '已复制' })).toBeInTheDocument();
    writeText.mockRejectedValueOnce(new Error('denied'));
    await user.click(within(panel).getAllByRole('button', { name: '复制' })[0]!);
    expect(await within(panel).findByRole('button', { name: /复制失败/ })).toBeInTheDocument();
  });
});

describe('结果未知（console-chat 问题 3）不能直接重复提交', () => {
  it.each<[string, number, number | null]>([
    ['504 / 5040', 504, 5040],
    ['网关 504 不是 JSON', 504, null],
    ['网关 502 不是 JSON', 502, null],
  ])('%s：框关闭，生成被锁，提示到列表停用最新几条，确认后才能重新生成', async (_name, status, code) => {
    const user = userEvent.setup();
    replies[`POST ${LIST}`] = [{ status, body: code ? { code } : 'x' }];
    open('/invites');
    await fillAndGenerate(user, '3');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('生成结果未知');
    expect(alert).toHaveTextContent('停用最新的几条（最多 3 条）');
    expect(alert).toHaveTextContent('不要直接重复提交');
    expect(screen.queryByRole('dialog', { name: '生成邀请码' })).toBeNull();
    expect(screen.getByRole('button', { name: '生成邀请码' })).toBeDisabled();
    expect(posts(LIST).length).toBe(1);
    // 列表刷新过：可能多出来的那几条能看到。
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === LIST).length).toBe(2));

    await user.click(screen.getByRole('button', { name: '已核对并停用，重新生成' }));
    expect(screen.getByRole('button', { name: '生成邀请码' })).toBeEnabled();
    expect(posts(LIST).length).toBe(1);
  });

  it('网络断开同样按结果未知处理', async () => {
    const user = userEvent.setup();
    open('/invites');
    const ok = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (path, init) => {
      if (init?.method === 'POST' && path === LIST) throw new TypeError('failed');
      return ok(path as string, init);
    });
    await fillAndGenerate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('生成结果未知');
    expect(screen.getByRole('button', { name: '生成邀请码' })).toBeDisabled();
  });
});

describe('TC-ACC-09-03 停用', () => {
  const path = `${LIST}/inv1/disable`;

  it('只要确认框：没有理由和动态码；请求体是 {}；成功后刷新列表', async () => {
    const user = userEvent.setup();
    replies[`GET ${LIST}`] = [{ body: { invites: [row()] } }, { body: { invites: [row({ disabledAt: 5 })] } }];
    replies[`POST ${path}`] = [{ body: {} }];
    open('/invites');
    await user.click(await screen.findByRole('button', { name: '停用' }));
    const dlg = screen.getByRole('dialog', { name: '停用邀请码' });
    expect(dlg).toHaveTextContent('不能重新启用');
    expect(within(dlg).queryByLabelText('理由')).toBeNull();
    expect(posts(path)).toEqual([]);
    await user.click(within(dlg).getByRole('button', { name: '停用' }));
    await waitFor(() => expect(screen.getByRole('row', { name: /AbCd/ })).toHaveTextContent('已停用'));
    expect(posts(path)[0]!.body).toEqual({});
    expect(screen.queryByRole('dialog', { name: '停用邀请码' })).toBeNull();
  });

  it('取消不发请求', async () => {
    const user = userEvent.setup();
    replies[`GET ${LIST}`] = [{ body: { invites: [row()] } }];
    open('/invites');
    await user.click(await screen.findByRole('button', { name: '停用' }));
    await user.click(within(screen.getByRole('dialog', { name: '停用邀请码' })).getByRole('button', { name: '取消' }));
    expect(posts(path)).toEqual([]);
  });

  it.each<[number, number, RegExp]>([
    [404, 4040, /没有找到/],
    [400, 4004, /ID 格式不正确/],
    [503, 5031, /审计服务不可用，操作未执行/],
  ])('%i / %i：提示留在框里，列表刷新', async (status, code, text) => {
    const user = userEvent.setup();
    replies[`GET ${LIST}`] = [{ body: { invites: [row()] } }];
    replies[`POST ${path}`] = [{ status, body: { code } }];
    open('/invites');
    await user.click(await screen.findByRole('button', { name: '停用' }));
    const dlg = screen.getByRole('dialog', { name: '停用邀请码' });
    await user.click(within(dlg).getByRole('button', { name: '停用' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(text);
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === LIST).length).toBe(2));
  });
});

describe('TC-ACC-09-09、TC-ACC-09-11 用户详情的账号信息', () => {
  const user = (over: Partial<UserRow>): UserRow => ({
    userId: 'u1',
    createdAt: Date.UTC(2020, 0, 2, 4),
    official: false,
    online: false,
    ...over,
  });
  const show = async (u: UserRow) => {
    replies['GET /console/api/users/u1'] = [{ body: u }];
    open('/users/u1', ['user.read', 'user.kick', 'user.sessions', 'user.ban', 'mute.write']);
    await screen.findByRole('heading', { name: '账号信息' });
    return screen.getByRole('heading', { name: '账号信息' }).closest('section')!;
  };

  it('有账号：注册时间用 account.createdAt，不用顶层资料时间；有最近登录和会话数；没有重置密码类操作', async () => {
    const panel = await show(
      user({
        account: {
          hasAccount: true,
          createdAt: Date.UTC(2026, 10, 1, 4),
          lastLoginAt: Date.UTC(2026, 10, 3, 4),
          sessions: 2,
        },
      }),
    );
    expect(panel).toHaveTextContent('有账号');
    expect(panel).toHaveTextContent('注册时间2026/11/01 12:00:00');
    expect(panel).toHaveTextContent('最近登录时间2026/11/03 12:00:00');
    expect(panel).toHaveTextContent('设备会话数2');
    // 顶层时间是资料时间，只出现在资料区，不叫注册时间。
    expect(panel).not.toHaveTextContent('2020');
    expect(document.body).toHaveTextContent('资料创建时间2020/01/02 12:00:00');
    expect(screen.getAllByText('注册时间').length).toBe(1);
    const main = screen.getByRole('main');
    expect(main.textContent).not.toMatch(/重置|重设|改密|修改密码|恢复码|reset/i);
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('link')).toBeNull();
  });

  it('没有账号：hasAccount=false 才显示没有账号', async () => {
    const panel = await show(user({ account: { hasAccount: false, sessions: 0 } }));
    expect(panel).toHaveTextContent('没有账号');
    expect(panel).not.toHaveTextContent('注册时间');
    expect(panel).not.toHaveTextContent('暂不可用');
  });

  it('取不到：显示暂不可用，不能显示没有账号，资料照常', async () => {
    const panel = await show(user({ account: null, accountUnavailable: true }));
    expect(panel).toHaveTextContent('暂不可用');
    expect(panel.textContent).not.toMatch(/是否有账号|有账号：|^没有账号/);
    expect(within(panel).queryByText('没有账号')).toBeNull();
    expect(screen.getByRole('button', { name: '强制下线' })).toBeInTheDocument();
  });

  it('响应里没有 account 字段：也是暂不可用，不猜', async () => {
    const panel = await show(user({}));
    expect(panel).toHaveTextContent('暂不可用');
    expect(within(panel).queryByText('没有账号')).toBeNull();
  });
});
