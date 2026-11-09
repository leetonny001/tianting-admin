import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClient } from '../api/client';
import { SessionProvider } from '../session';
import { GroupDetailPage } from './GroupDetail';
import { MetaPage } from './Meta';
import { UserDetailPage } from './UserDetail';

// FE-441：全群禁言、用户所在群、用户会话列表。用真实的 SessionProvider 和 API 客户端，只换 fetch。

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply[]>;
let calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
const REASON = '用户投诉工单核查';

function install(perms: string[]) {
  const session = {
    account: { id: 'me', username: 'kf1', displayName: 'kf1', space: 'admin' },
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
  return <div data-testid="where">{`${loc.pathname} ${JSON.stringify(loc.state)}`}</div>;
}

function open(entry: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/groups/:id" element={<GroupDetailPage />} />
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/messages" element={<MetaPage />} />
        </Routes>
        <Where />
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  replies = {};
  calls = [];
  resetClient();
  // jsdom 的 <dialog> 没有 showModal。
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('群详情的全员禁言（AC-ADM-42-3）', () => {
  const group = (allMuted: boolean) => ({
    groupId: 'g1',
    name: '群一',
    historyVisible: true,
    createdAt: 1,
    memberCount: 3,
    owner: null,
    managed: true,
    allMuted,
  });
  const detail = 'GET /console/api/groups/g1';
  const members = 'GET /console/api/groups/g1/members?';
  beforeEach(() => {
    replies[members] = [{ body: { members: [], nextCursor: '' } }];
  });

  it('状态来自服务端：没开显示未开启，开了显示全员禁言中', async () => {
    install(['group.read', 'mute.write']);
    replies[detail] = [{ body: group(true) }];
    open('/groups/g1');
    expect(await screen.findByText('全员禁言中')).toBeVisible();
    expect(screen.getByRole('button', { name: '关闭全员禁言' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '开启全员禁言' })).toBeNull();
  });

  it('开启要填理由，提交后重新读详情，不自己改状态', async () => {
    install(['group.read', 'mute.write']);
    // 接口成功但 im-server 说还没开：页面要听 im-server 的。
    replies[detail] = [{ body: group(false) }, { body: group(false) }, { body: group(true) }];
    replies['POST /console/api/mutes'] = [{ body: { mutedUntil: null } }];
    const user = userEvent.setup();
    open('/groups/g1');
    await user.click(await screen.findByRole('button', { name: '开启全员禁言' }));
    const dlg = await screen.findByRole('dialog', { name: '开启全员禁言', hidden: true });
    const submit = within(dlg).getByRole('button', { name: '开启', hidden: true });
    expect(submit).toBeDisabled();
    await user.type(within(dlg).getByLabelText('理由'), REASON);
    await user.click(submit);
    await waitFor(() => expect(posts('/console/api/mutes')).toHaveLength(1));
    expect(posts('/console/api/mutes')[0]!.body).toEqual({ scope: 'groupAll', groupId: 'g1', reason: REASON });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '开启全员禁言', hidden: true })).toBeNull());
    expect(screen.queryByText('全员禁言中')).toBeNull();
    expect(screen.getByText('未开启')).toBeVisible();
  });

  it('关闭走 release，没有时长字段', async () => {
    install(['group.read', 'mute.write']);
    replies[detail] = [{ body: group(true) }, { body: group(false) }];
    replies['POST /console/api/mutes/release'] = [{ body: {} }];
    const user = userEvent.setup();
    open('/groups/g1');
    await user.click(await screen.findByRole('button', { name: '关闭全员禁言' }));
    const dlg = await screen.findByRole('dialog', { name: '关闭全员禁言', hidden: true });
    await user.type(within(dlg).getByLabelText('理由'), REASON);
    await user.click(within(dlg).getByRole('button', { name: '关闭', hidden: true }));
    await waitFor(() => expect(posts('/console/api/mutes/release')).toHaveLength(1));
    expect(posts('/console/api/mutes/release')[0]!.body).toEqual({ scope: 'groupAll', groupId: 'g1', reason: REASON });
    expect(await screen.findByText('未开启')).toBeVisible();
  });

  it('没有 mute.write 只能看状态，没有按钮', async () => {
    install(['group.read']);
    replies[detail] = [{ body: group(true) }];
    open('/groups/g1');
    expect(await screen.findByText('全员禁言中')).toBeVisible();
    expect(screen.queryByRole('button', { name: /全员禁言/ })).toBeNull();
  });
});

describe('用户详情的所在群和会话列表', () => {
  const USER = 'GET /console/api/users/u1';
  const GROUPS = 'GET /console/api/users/u1/groups';
  const CONVS = '/console/api/users/convs/query';
  const userRow = { userId: 'u1', nickname: 'n', online: false, official: false, createdAt: 1 };
  const conv = (convId: string, type: string) => ({ convId, type, updatedAt: Date.UTC(2027, 0, 1) });
  beforeEach(() => {
    replies[USER] = [{ body: userRow }];
    replies[GROUPS] = [{ body: { groups: [], nextCursor: '' } }];
  });

  it('所在群分页，点击进群详情；没有 group.read 不请求', async () => {
    install(['user.read', 'group.read']);
    const groupRow = (id: string) => ({
      groupId: id,
      name: `群${id}`,
      type: 'managed',
      memberCount: 2,
      role: 'admin',
      joinedAt: 1,
    });
    replies[GROUPS] = [{ body: { groups: [groupRow('g1')], nextCursor: 'c1' } }];
    replies[`${GROUPS}?cursor=c1`] = [{ body: { groups: [groupRow('g2')], nextCursor: '' } }];
    const user = userEvent.setup();
    open('/users/u1');
    const link = await screen.findByRole('link', { name: 'g1' });
    expect(link).toHaveAttribute('href', '/groups/g1');
    expect(screen.getByRole('row', { name: /g1/ })).toHaveTextContent('管理员');
    await user.click(within(link.closest('section')!).getByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('link', { name: 'g2' })).toBeVisible();
    expect(within(link.closest('section')!).queryByRole('button', { name: '加载更多' })).toBeNull();
    cleanup();
    calls = [];
    install(['user.read']);
    open('/users/u1');
    await screen.findByText('未封禁');
    expect(calls.some((c) => c.path.includes('/groups'))).toBe(false);
  });

  it('会话列表先填理由才发请求，userId 和理由只在请求体；只显示三列；翻页不带理由', async () => {
    install(['user.read', 'msg.meta']);
    // 响应里就算多了摘要，页面也不显示。
    replies[`POST ${CONVS}`] = [
      {
        body: {
          convs: [{ ...conv('c2c:u1:u2', 'c2c'), lastText: 'ZXQ-SUMMARY' }, conv('group:g1', 'group')],
          nextCursor: 'c1',
        },
      },
      { body: { convs: [conv('group:g2', 'group')], nextCursor: '' } },
    ];
    const user = userEvent.setup();
    open('/users/u1');
    await user.click(await screen.findByRole('button', { name: '查看会话列表' }));
    expect(posts(CONVS)).toHaveLength(0);
    const dlg = await screen.findByRole('dialog', { name: '查看会话列表', hidden: true });
    const submit = within(dlg).getByRole('button', { name: '查询', hidden: true });
    expect(submit).toBeDisabled();
    await user.type(within(dlg).getByLabelText('理由'), REASON);
    await user.click(submit);
    await waitFor(() => expect(posts(CONVS)).toHaveLength(1));
    expect(posts(CONVS)[0]!.body).toEqual({ userId: 'u1', reason: REASON });
    const row = await screen.findByRole('row', { name: /c2c:u1:u2/ });
    expect(row).toHaveTextContent('单聊');
    expect(screen.getByRole('row', { name: /group:g1/ })).toHaveTextContent('群聊');
    expect(document.body).not.toHaveTextContent('ZXQ-SUMMARY');
    const heads = within(row.closest('table')!)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual(['会话 ID', '类型', '最后活跃']);
    await user.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByRole('row', { name: /group:g2/ });
    expect(posts(CONVS)[1]!.body).toEqual({ userId: 'u1', cursor: 'c1' });
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    for (const c of calls) expect(c.path).not.toContain(REASON);
    expect(calls.filter((c) => c.path.includes('convs')).every((c) => !c.path.includes('u1'))).toBe(true);
  });

  it('理由被服务端拒绝时留在框里，列表不打开', async () => {
    install(['user.read', 'msg.meta']);
    replies[`POST ${CONVS}`] = [{ status: 403, body: { code: 4030, msg: 'denied' } }];
    const user = userEvent.setup();
    open('/users/u1');
    await user.click(await screen.findByRole('button', { name: '查看会话列表' }));
    const dlg = await screen.findByRole('dialog', { name: '查看会话列表', hidden: true });
    await user.type(within(dlg).getByLabelText('理由'), REASON);
    await user.click(within(dlg).getByRole('button', { name: '查询', hidden: true }));
    expect(await within(dlg).findByRole('alert')).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: '会话 ID', hidden: true })).toBeNull();
  });

  it('超过 15 分钟翻页：提示重新填理由', async () => {
    install(['user.read', 'msg.meta']);
    replies[`POST ${CONVS}`] = [
      { body: { convs: [conv('group:g1', 'group')], nextCursor: 'c1' } },
      { status: 400, body: { code: 4000, msg: 'reason', reason: 'reasonInvalid' } },
    ];
    const user = userEvent.setup();
    open('/users/u1');
    await user.click(await screen.findByRole('button', { name: '查看会话列表' }));
    const dlg = await screen.findByRole('dialog', { name: '查看会话列表', hidden: true });
    await user.type(within(dlg).getByLabelText('理由'), REASON);
    await user.click(within(dlg).getByRole('button', { name: '查询', hidden: true }));
    await user.click(await screen.findByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已超过 15 分钟');
    expect(screen.getByRole('button', { name: '查看会话列表' })).toBeVisible();
  });

  it('点会话进元数据页：群直接查，单聊先要理由（F-ADM-30 规则 3）', async () => {
    install(['user.read', 'msg.meta']);
    replies['POST /console/api/messages/meta/query'] = [{ body: { messages: [], hasMore: false } }];
    open({ pathname: '/messages', state: { convId: 'c2c:u1:u2' } });
    expect(await screen.findByRole('dialog', { hidden: true })).toBeVisible();
    await waitFor(() => expect(calls.some((c) => c.path === '/console/api/session')).toBe(true));
    expect(posts('/console/api/messages/meta/query')).toHaveLength(0);
    cleanup();
    open({ pathname: '/messages', state: { convId: 'group:g1' } });
    await waitFor(() => expect(posts('/console/api/messages/meta/query')).toHaveLength(1));
    expect(posts('/console/api/messages/meta/query')[0]!.body).toEqual({ convId: 'group:g1' });
  });
});

describe('元数据页配合文件消息（FE-639，AC-ADM-30-7、PRD-chat 第 14.1 节）', () => {
  it('图片、文件消息只显示类型和长度，没有文件名（响应里本来就没有）', async () => {
    install(['msg.meta']);
    const row = (seq: number, type: string) => ({ seq, msgId: `m${seq}`, from: 'u1', type, bodyLength: 30, ts: 1 });
    replies['POST /console/api/messages/meta/query'] = [
      { body: { messages: [row(3, 'file'), row(2, 'image'), row(1, 'text')], hasMore: false } },
    ];
    open({ pathname: '/messages', state: { convId: 'group:g1' } });
    const table = await screen.findByRole('table');
    const types = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[3]!.textContent);
    expect(types).toEqual(['文件', '图片', '文本']);
  });
});
