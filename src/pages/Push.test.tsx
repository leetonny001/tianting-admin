import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, resetClient } from '../api/client';
import { errorText } from '../api/errors';
import type { PushDraft } from '../api/types';
import { buildData, fieldKind } from '../lib/pushForm';
import { PushDraftsPage, PushNewPage, PushRecordsPage, pushErrorText } from './Push';

const session = vi.hoisted(() => ({
  perms: [] as string[],
  accountId: 'me',
}));

vi.mock('../session', () => ({
  useSession: () => ({
    session: { account: { id: session.accountId, username: 'me', displayName: 'me', space: 'admin' } },
    can: (p: string) => session.perms.includes(p),
  }),
}));

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
let calls: { method: string; path: string; body: unknown }[];

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (path === '/console/api/session') return new Response(JSON.stringify({ csrfToken: 't' }));
      const r = replies[`${method} ${path}`];
      if (!r) return new Response(JSON.stringify({ code: 4040, msg: 'no reply' }), { status: 404 });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
}

const notice = {
  type: 'object',
  title: '公告',
  required: ['title', 'text'],
  properties: {
    title: { type: 'string', title: '标题', maxLength: 64 },
    text: { type: 'string', title: '正文', maxLength: 1000 },
    n: { type: 'integer', title: '数量' },
    level: { type: 'string', enum: ['info', 'warn'], title: '级别' },
    on: { type: 'boolean', title: '开关' },
    tags: { type: 'array', title: '标签' },
  },
};

const draft = (over: Partial<PushDraft>): PushDraft => ({
  id: 'd1',
  type: 'notice',
  dataPretty: '{\n  "text": "<img src=x onerror=alert(1)>"\n}',
  reason: '发布公告',
  createdBy: 'other',
  createdByName: 'op1',
  createdAt: 1,
  expiresAt: 2,
  status: 'pending',
  ...over,
});

beforeEach(() => {
  resetClient();
  session.perms = [];
  session.accountId = 'me';
  replies = {};
  calls = [];
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('模板表单', () => {
  it('按 Schema 选字段类型', () => {
    expect(fieldKind({ type: 'string', maxLength: 64 })).toBe('text');
    expect(fieldKind({ type: 'string', maxLength: 1000 })).toBe('textarea');
    expect(fieldKind({ type: 'string' })).toBe('textarea');
    expect(fieldKind({ type: 'integer' })).toBe('integer');
    expect(fieldKind({ type: ['boolean', 'null'] })).toBe('boolean');
    expect(fieldKind({ type: 'string', enum: ['a'] })).toBe('select');
    expect(fieldKind({ type: 'object' })).toBe('json');
  });
  it('表单值 → data', () => {
    const r = buildData(notice, { title: 'a', text: 'b', n: '3', level: 'warn', on: true, tags: '["x"]' });
    expect(r.errors).toEqual({});
    expect(r.data).toEqual({ title: 'a', text: 'b', n: 3, level: 'warn', on: true, tags: ['x'] });
  });
  it('必填、数字、JSON 的错误；没填的可选字段不出现', () => {
    const r = buildData(notice, { title: '', n: '1.5', tags: '{', level: '' });
    expect(r.errors).toEqual({ title: '必填', text: '必填', n: '需要填数字', tags: '需要是合法的 JSON' });
    expect(buildData(notice, { title: 'a', text: 'b' }).data).toEqual({ title: 'a', text: 'b' });
    expect(buildData(notice, { title: 'a', text: 'b', n: '9007199254740993' }).errors.n).toBe('数字太大');
  });
});

describe('错误文案', () => {
  it('5040 是系统通知的例外', () => {
    const e = new ApiError(504, 5040, 'x');
    expect(pushErrorText(e)).toBe('结果未知，系统会自动确认，请稍后查看发送记录');
    expect(errorText(e)).toBe('操作结果未知，请刷新确认，不要重复提交'); // 其他操作不变
  });
  it('4042 列出 details.userIds', () => {
    expect(pushErrorText(new ApiError(404, 4042, 'x', undefined, { userIds: ['g1', 'g2'] }))).toBe(
      '这些用户不存在，整批未发送：g1、g2',
    );
  });
  it('4290 间隔、4131、模板错误', () => {
    expect(pushErrorText(new ApiError(429, 4290, 'x', 'pushAllInterval'))).toBe('全员通知间隔不少于 5 分钟');
    expect(pushErrorText(new ApiError(400, 4131, 'x', 'pushTooManyUsers'))).toBe('单次最多 1000 个用户');
    expect(pushErrorText(new ApiError(400, 4000, 'x', 'dataInvalid'))).toBe('通知内容不符合模板要求');
  });
});

describe('新建通知', () => {
  const page = () =>
    render(
      <MemoryRouter>
        <PushNewPage />
      </MemoryRouter>,
    );
  const fill = async () => {
    const user = userEvent.setup();
    await screen.findByLabelText('标题');
    await user.type(screen.getByLabelText('userId'), 'u1,u2');
    await user.type(screen.getByLabelText('标题'), 't');
    await user.type(screen.getByLabelText('正文'), 'b');
    await user.type(screen.getByLabelText('理由'), '发布公告');
    return user;
  };
  beforeEach(() => {
    session.perms = ['push.user', 'push.all.request'];
    replies['GET /console/api/push/templates'] = {
      body: { templates: [{ type: 'notice', title: '公告', schema: notice }] },
    };
    replies['POST /console/api/push/preview'] = {
      body: { target: 'user', targetCount: 2, type: 'notice', dataLength: 3, data: '{\n  "text": "<b>x</b>"\n}' },
    };
  });

  it('发送前必须预览；预览显示人数、type、格式化 data（纯文本）', async () => {
    page();
    const user = await fill();
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(await screen.findByText('2 人')).toBeInTheDocument();
    const pre = screen.getByTestId('push-preview-data');
    expect(pre.textContent).toContain('<b>x</b>');
    expect(pre.querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
    // 预览期间内容不能改。
    expect(screen.getByLabelText('标题')).toBeDisabled();
    expect(calls.some((c) => c.path === '/console/api/push/user')).toBe(false);
  });

  it('发送的内容就是预览的内容，理由和工单号都带上；URL 里没有内容', async () => {
    replies['POST /console/api/push/user'] = { body: { created: true, accepted: 2 } };
    page();
    const user = await fill();
    await user.type(screen.getByLabelText('工单号（可选）'), 'T-1');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(await screen.findByRole('button', { name: '发送' }));
    await screen.findByText('已发送，目标 2 人。');
    const call = calls.find((c) => c.path === '/console/api/push/user')!;
    expect(call.body).toEqual({
      userIds: ['u1', 'u2'],
      type: 'notice',
      data: { title: 't', text: 'b' },
      reason: '发布公告',
      ticket: 'T-1',
    });
    for (const c of calls) expect(c.path).not.toContain('发布公告');
  });

  it('5040 显示系统通知的文案，不让再点一次发送', async () => {
    replies['POST /console/api/push/user'] = { status: 504, body: { code: 5040, msg: 'x' } };
    page();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(await screen.findByRole('button', { name: '发送' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('结果未知，系统会自动确认，请稍后查看发送记录');
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  });

  it('4042 列出不存在的用户', async () => {
    replies['POST /console/api/push/user'] = {
      status: 404,
      body: { code: 4042, msg: 'x', details: { userIds: ['g1'] } },
    };
    page();
    const user = await fill();
    await user.click(screen.getByRole('button', { name: '预览' }));
    await user.click(await screen.findByRole('button', { name: '发送' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('这些用户不存在，整批未发送：g1');
  });

  it('全员：提交的是草稿，只带 type、data、reason', async () => {
    replies['POST /console/api/push/preview'] = {
      body: { target: 'all', targetCount: 0, type: 'notice', dataLength: 3, data: '{}' },
    };
    replies['POST /console/api/push/all/drafts'] = { body: { draftId: 'd1' } };
    page();
    const user = userEvent.setup();
    await screen.findByLabelText('标题');
    await user.selectOptions(screen.getByLabelText('发送范围'), 'all');
    await user.type(screen.getByLabelText('标题'), 't');
    await user.type(screen.getByLabelText('正文'), 'b');
    await user.type(screen.getByLabelText('理由'), '发布公告');
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(await screen.findByText('全员（当前在线的用户）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '提交全员草稿' }));
    await screen.findByText(/草稿已提交/);
    expect(calls.find((c) => c.path === '/console/api/push/all/drafts')!.body).toEqual({
      type: 'notice',
      data: { title: 't', text: 'b' },
      reason: '发布公告',
    });
  });

  it('没有 push.all.request 时没有全员选项', async () => {
    session.perms = ['push.user'];
    page();
    await screen.findByLabelText('标题');
    expect(screen.queryByRole('option', { name: /全员/ })).toBeNull();
  });
});

describe('草稿', () => {
  const page = () =>
    render(
      <MemoryRouter>
        <PushDraftsPage />
      </MemoryRouter>,
    );

  it('自己发起的不显示批准按钮；内容是纯文本', async () => {
    session.perms = ['push.all.request', 'push.all.approve'];
    replies['GET /console/api/push/all/drafts'] = {
      body: { drafts: [draft({ id: 'mine', createdBy: 'me', createdByName: 'me' }), draft({ id: 'theirs' })] },
    };
    const { container } = page();
    await screen.findByText('me');
    expect(screen.getAllByRole('button', { name: '批准' })).toHaveLength(1);
    expect(container.querySelector('img')).toBeNull();
  });

  it('运营没有批准按钮', async () => {
    session.perms = ['push.all.request'];
    replies['GET /console/api/push/all/drafts'] = { body: { drafts: [draft({})] } };
    page();
    await screen.findByText('op1');
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
  });

  it('批准要输入"全员发送"；4290 留在框内显示间隔提示', async () => {
    session.perms = ['push.all.approve'];
    replies['GET /console/api/push/all/drafts/pending'] = { body: { drafts: [draft({})] } };
    replies['POST /console/api/push/all/drafts/d1/approve'] = {
      status: 429,
      body: { code: 4290, msg: 'x', reason: 'pushAllInterval' },
    };
    page();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(await screen.findByRole('button', { name: '批准' }));
    const submit = screen.getByRole('button', { name: '批准并发送', hidden: true });
    expect(submit).toBeDisabled();
    // jsdom 的 <dialog> 没有打开（没有 showModal），里面的元素 user-event 点不到。
    fireEvent.change(screen.getByLabelText('请输入 全员发送 确认'), { target: { value: '全员发送' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert', { hidden: true })).toHaveTextContent('全员通知间隔不少于 5 分钟');
    const call = calls.find((c) => c.path.endsWith('/approve'))!;
    expect(call.body).toEqual({ confirmText: '全员发送' });
  });

  it('批准的 5040 用系统通知的文案', async () => {
    session.perms = ['push.all.approve'];
    replies['GET /console/api/push/all/drafts/pending'] = { body: { drafts: [draft({})] } };
    replies['POST /console/api/push/all/drafts/d1/approve'] = { status: 504, body: { code: 5040, msg: 'x' } };
    page();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(await screen.findByRole('button', { name: '批准' }));
    fireEvent.change(screen.getByLabelText('请输入 全员发送 确认'), { target: { value: '全员发送' } });
    fireEvent.click(screen.getByRole('button', { name: '批准并发送', hidden: true }));
    expect(await screen.findByRole('alert', { hidden: true })).toHaveTextContent('结果未知，系统会自动确认');
  });

  it('作废的草稿显示已作废', async () => {
    session.perms = ['push.all.request'];
    replies['GET /console/api/push/all/drafts'] = { body: { drafts: [draft({ status: 'expired' })] } };
    page();
    expect(await screen.findByText('已作废')).toBeInTheDocument();
  });
});

describe('发送记录', () => {
  it('显示全文（纯文本）、发送人、批准人、状态，能翻页', async () => {
    const rec = {
      id: 'r1',
      kind: 'all',
      type: 'notice',
      dataPretty: '{\n  "text": "<img src=x>"\n}',
      dataSha256: 'abc',
      userIds: [],
      targetCount: 0,
      reason: '发布公告',
      createdByName: 'op1',
      approvedByName: 'adm1',
      sentAt: 5,
      pushId: 'p1',
      status: 'unknown',
      replayExpired: true,
    };
    replies['GET /console/api/push/records'] = { body: { records: [rec], nextBefore: 5 } };
    replies['GET /console/api/push/records?before=5'] = {
      body: {
        records: [{ ...rec, id: 'r2', status: 'success', replayExpired: false, replayedAt: 9 }],
        nextBefore: null,
      },
    };
    const { container } = render(<PushRecordsPage />);
    expect(await screen.findByText(/<img src=x>/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('全员')).toBeInTheDocument();
    expect(screen.getByText('adm1')).toBeInTheDocument();
    expect(screen.getByText('结果未知')).toBeInTheDocument();
    expect(screen.getByText(/超过 1 小时未自动重放/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(screen.getByText('已自动重放一次')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });
});
