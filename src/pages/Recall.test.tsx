import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBlob, ApiError, NETWORK, resetClient } from '../api/client';
import type { BodyMessage } from '../api/types';
import { downloadName, REVOKE_AFTER_MS, saveBlob } from '../lib/download';
import { formatTime } from '../lib/format';
import { SessionProvider } from '../session';
import { fetchable, mentionText, MessageBodyPage, quoteText } from './MessageBody';
import { MetaPage } from './Meta';

// FE-671：后台的撤回状态、引用和提及、经代理查看文件（PRD-chat C4 第 11.6、14.1 节，CS-204、CS-202）。
// 用真实的 SessionProvider 和 API 客户端，只换 fetch 和 blob 地址。

type Reply = { status?: number; body: unknown; bytes?: string };
let replies: Record<string, Reply[]>;
let calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
let created: string[];
let revoked: string[];
let clicked: { href: string; download: string }[];

function install(perms: string[]) {
  const session = {
    account: { id: 'me', username: 'md1', displayName: 'md1', space: 'admin' },
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
      if (r.bytes !== undefined)
        return new Response(r.bytes, { status: 200, headers: { 'Content-Disposition': 'attachment' } });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
}

/** 整段文字（中间有 Text 组件拆开的节点）。 */
const para = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text;

const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);

function open(path: string, state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <SessionProvider>
        <Routes>
          <Route path="/messages" element={<MetaPage />} />
          <Route path="/messages/body" element={<MessageBodyPage />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

const T = Date.UTC(2026, 10, 10, 2, 3, 4);
const msg = (seq: number, more: Partial<BodyMessage> = {}): BodyMessage => ({
  seq,
  msgId: `m${seq}`,
  from: 'u1',
  type: 'text',
  ts: T,
  ...more,
});

beforeEach(() => {
  replies = {};
  calls = [];
  created = [];
  revoked = [];
  clicked = [];
  resetClient();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const u = `blob:http://localhost/b${++n}`;
    created.push(u);
    return u;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
    revoked.push(u);
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TC-RCL-04-07 元数据页的撤回状态（AC-RCL-04-7，FE-671 第 1 条）', () => {
  it('TC-RCL-04-07 撤回显示"已撤回（撤回人，时间）"，和"已删除"分开；没有文件名、引用文字', async () => {
    install(['msg.meta']);
    const row = (seq: number, type: string, more: object = {}) => ({
      seq,
      msgId: `m${seq}`,
      from: 'u1',
      type,
      bodyLength: 0,
      ts: T,
      ...more,
    });
    replies['POST /console/api/messages/meta/query'] = [
      {
        body: {
          messages: [
            row(4, 'file', { recalled: true, recalledAt: T + 1000, recalledBy: 'u1' }),
            row(3, 'text', { recalled: true, recalledAt: T + 2000, recalledBy: 'console:adm1' }),
            row(2, 'text', { deleted: true, deletedAt: T + 3000, deletedBy: 'console:adm2' }),
            row(1, 'text', { bodyLength: 12 }),
          ],
          hasMore: false,
        },
      },
    ];
    open('/messages', { convId: 'group:g1' });
    const table = await screen.findByRole('table');
    const status = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[6]!.textContent);
    expect(status).toEqual([
      `已撤回（u1，${formatTime(T + 1000)}）`,
      `已撤回（console:adm1，${formatTime(T + 2000)}）`,
      `已删除（console:adm2，${formatTime(T + 3000)}）`,
      '',
    ]);
    // 撤回的文件：大小列按正文长度（响应里没有 fileSize），类型照旧，页面上没有"引用"。
    expect(within(table).getAllByRole('row')[1]!.textContent).toContain('文件');
    expect(document.body.textContent).not.toContain('引用');
  });
});

describe('TC-RCL-04-03 正文页的撤回、引用和提及（AC-RCL-04-3，FE-671 第 2 条）', () => {
  const page = (messages: BodyMessage[]) => ({
    body: { messages, hasMore: false, grantPrefix: 'abcd1234', expiresAt: T },
  });

  it('TC-RCL-04-03 普通授权：撤回的显示"该消息已被撤回（撤回人，时间）"、没有正文；和删除分开；撤回的不能勾选', async () => {
    install(['msg.read.group', 'msg.delete']);
    replies['POST /console/api/messages/body'] = [
      page([
        // 普通授权本来没有 body；万一带了也不显示。
        msg(3, { recalled: true, recalledAt: T + 5000, recalledBy: 'u1', body: { text: 'ZXQ-NOT-SHOWN' } }),
        msg(2, { deleted: true, deletedAt: T + 6000, deletedBy: 'console:adm' }),
        msg(1, { body: { text: 'hello' } }),
      ]),
    ];
    open('/messages/body', { convId: 'group:g1' });
    expect(await screen.findByText(para(`该消息已被撤回（u1，${formatTime(T + 5000)}）`))).toBeVisible();
    expect(screen.getByText(para(`该消息已被删除（console:adm，${formatTime(T + 6000)}）`))).toBeVisible();
    expect(screen.getByText('hello')).toBeVisible();
    expect(document.body.textContent).not.toContain('ZXQ-NOT-SHOWN');
    // 撤回的、已删除的都不能勾选（P-44 ②，问题 29）。
    expect(screen.getByLabelText('选择第 3 条')).toBeDisabled();
    expect(screen.getByLabelText('选择第 1 条')).toBeEnabled();
    expect(screen.getByLabelText('选择第 2 条')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '下载查看' })).toBeNull();
    expect(posts('/console/api/messages/body')[0]!.body).toEqual({ convId: 'group:g1' });
  });

  it('TC-RCL-04-01 问题 29：撤回的复选框禁用并说明原因；删除请求和提示只含没撤回的', async () => {
    install(['msg.read.group', 'msg.delete']);
    const rows = [
      msg(5, { body: { text: 'five' } }),
      msg(4, { recalled: true, recalledAt: T + 1000, recalledBy: 'u1' }),
      msg(3, { body: { text: 'three' } }),
      msg(2, { deleted: true, deletedAt: T + 2000, deletedBy: 'console:adm' }),
      msg(1, { type: 'tip', body: { text: 'tip' } }),
    ];
    replies['POST /console/api/messages/body'] = [page(rows), page(rows)];
    replies['POST /console/api/messages/delete'] = [{ body: {} }];
    open('/messages/body', { convId: 'group:g1' });
    const recalled = await screen.findByLabelText('选择第 4 条');
    expect(recalled).toBeDisabled();
    expect(recalled).toHaveAccessibleDescription('已撤回的消息不能删除');
    expect(screen.getByLabelText('选择第 2 条')).not.toHaveAccessibleDescription('已撤回的消息不能删除');
    // 点禁用的复选框不会选中。
    await userEvent.click(recalled);
    expect(recalled).not.toBeChecked();

    await userEvent.click(screen.getByLabelText('选择第 5 条'));
    await userEvent.click(screen.getByLabelText('选择第 3 条'));
    expect(screen.getByLabelText('选择第 5 条')).toBeChecked();
    expect(screen.getByLabelText('选择第 3 条')).toBeChecked();
    expect(recalled).not.toBeChecked();
    expect(screen.getByLabelText('选择第 2 条')).not.toBeChecked();
    expect(screen.getByLabelText('选择第 1 条')).not.toBeChecked();
    const del = screen.getByRole('button', { name: '删除所选（2）' });

    await userEvent.click(del);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('将删除选中的 2 条消息');
    await userEvent.type(within(dialog).getByLabelText('理由'), '违规内容处理');
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('已删除 2 条，不再显示')).toBeVisible();
    const req = posts('/console/api/messages/delete');
    expect(req).toHaveLength(1);
    expect(req[0]!.body!.msgIds).toEqual(['m5', 'm3']);
    expect(req[0]!.body!.msgIds).not.toContain('m4');
  });

  it('TC-RCL-04-01 问题 29：勾选后重新授权、重新加载时变成撤回的，不进删除请求，也不计数', async () => {
    install(['msg.read.group', 'msg.delete']);
    const first = { messages: [msg(3, { body: { text: 'c' } }), msg(2, { body: { text: 'b' } })] };
    replies['POST /console/api/messages/body'] = [
      { body: { ...first, hasMore: true, grantPrefix: 'abcd1234', expiresAt: T } },
      // 授权过期：加载更早的时候 4039，重新授权后整页重拉，第 2 条这时已经撤回。
      { status: 403, body: { code: 4039 } },
      page([
        msg(3, { body: { text: 'c' } }),
        msg(2, { recalled: true, recalledAt: T, recalledBy: 'u1' }),
        msg(1, { body: { text: 'a' } }),
      ]),
    ];
    replies['POST /console/api/messages/grants'] = [{ body: { grantPrefix: 'abcd1234', expiresAt: T } }];
    replies['POST /console/api/messages/delete'] = [{ body: {} }];
    open('/messages/body', { convId: 'group:g1' });
    await userEvent.click(await screen.findByLabelText('选择第 3 条'));
    await userEvent.click(screen.getByLabelText('选择第 2 条'));
    expect(screen.getByRole('button', { name: '删除所选（2）' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '加载更早的' }));
    const grant = await screen.findByRole('dialog');
    await userEvent.type(within(grant).getByLabelText('工单号'), 'T-29');
    await userEvent.type(within(grant).getByLabelText('理由'), '违规内容处理');
    await userEvent.type(within(grant).getByLabelText('动态码'), '123456');
    await userEvent.click(within(grant).getByRole('button', { name: '查看' }));
    await screen.findByLabelText('选择第 1 条');
    expect(screen.getByLabelText('选择第 2 条')).toBeDisabled();
    expect(screen.getByLabelText('选择第 2 条')).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '删除所选（1）' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('理由'), '违规内容处理');
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('已删除 1 条，不再显示')).toBeVisible();
    expect(posts('/console/api/messages/delete')[0]!.body!.msgIds).toEqual(['m3']);
  });

  it('TC-RCL-04-03 隔离授权：显示撤回原文和撤回人；正文页没有删除', async () => {
    install(['msg.read.group', 'msg.quarantine.read', 'msg.delete']);
    replies['POST /console/api/messages/body'] = [
      page([msg(3, { recalled: true, recalledAt: T + 5000, recalledBy: 'u1', body: { text: 'ZXQ-RCL 原文' } })]),
    ];
    open('/messages/body', { convId: 'group:g1', quarantine: true });
    expect(await screen.findByText('ZXQ-RCL 原文')).toBeVisible();
    const line = [...document.querySelectorAll('.body-row p.muted')].map((p) => p.textContent);
    expect(line).toContain(`撤回人 u1，${formatTime(T + 5000)}`);
    expect(screen.queryByText(/该消息已被撤回/)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(posts('/console/api/messages/body')[0]!.body).toEqual({ convId: 'group:g1', quarantine: true });
  });

  it('TC-RCL-04-03 引用显示"引用：{摘要}"、提及显示被 @ 的 userId，都是纯文本', async () => {
    install(['msg.read.group']);
    replies['POST /console/api/messages/body'] = [
      page([
        msg(4, {
          body: {
            text: '回复 @bob',
            quote: { msgId: 'm1', seq: 1, from: 'u2', type: 'text', state: 'normal', text: '<b>原话</b>' },
            mentions: { userIds: ['bob', 'carol', 'bob'] },
          },
        }),
        msg(3, { body: { text: '大家看', mentions: { userIds: [], all: true } } }),
        msg(2, { body: { text: '回复已撤回的', quote: { msgId: 'm0', state: 'recalled' } } }),
      ]),
    ];
    open('/messages/body', { convId: 'group:g1' });
    expect(await screen.findByText('引用：<b>原话</b>')).toBeVisible();
    expect(screen.getByText('提及：bob、carol')).toBeVisible();
    expect(screen.getByText('提及：所有人')).toBeVisible();
    expect(screen.getByText('引用：引用内容已被撤回')).toBeVisible();
    expect(document.querySelector('.body-area b')).toBeNull();
  });

  it('TC-RCL-04-03 引用摘要按 F-QUO-02 规则 3；提及去重、"所有人"在前', () => {
    expect(quoteText({ state: 'normal', text: '[文件] a.pdf' })).toBe('[文件] a.pdf');
    expect(quoteText({ text: '没有 state 按 normal' })).toBe('没有 state 按 normal');
    expect(quoteText({ state: 'recalled' })).toBe('引用内容已被撤回');
    expect(quoteText({ state: 'deleted' })).toBe('引用内容已被删除');
    expect(quoteText({ state: 'expired', type: 'image' })).toBe('[图片] 已过期');
    expect(quoteText({ state: 'expired', type: 'file' })).toBe('[文件] 已过期');
    expect(quoteText({ state: 'weird', text: 'x' })).toBe('引用内容不可用');
    expect(mentionText({ userIds: ['a', 'b', 'a'], all: true })).toBe('所有人、a、b');
    expect(mentionText({})).toBe('');
  });
});

describe('TC-RCL-04-09 经代理下载查看文件（AC-RCL-04-9，FE-671 第 3 条，CS-202）', () => {
  const page = (messages: BodyMessage[]) => ({
    body: { messages, hasMore: false, grantPrefix: 'abcd1234', expiresAt: T },
  });
  const NAME = 'ZXQ-RCL-报告 v2.pdf';
  const recalledFile = msg(5, {
    type: 'file',
    recalled: true,
    recalledAt: T,
    recalledBy: 'u1',
    body: { file: { fileId: 'F1', name: NAME, size: 9, mime: 'application/pdf' } },
  });
  const deletedImage = msg(4, {
    type: 'image',
    deleted: true,
    deletedAt: T,
    deletedBy: 'console:a',
    body: { image: { fileId: 'F2', width: 4, height: 3, size: 5, mime: 'image/png' } },
  });
  const liveFile = msg(3, { type: 'file', body: { file: { fileId: 'F3', name: 'live.pdf', size: 1 } } });
  const expired = msg(2, { type: 'file', recalled: true, body: { file: { fileId: 'F4', name: '', expired: true } } });

  it('TC-RCL-04-09 只有隔离模式下撤回或删除的图片、文件有按钮；没撤回的、过期的、普通授权没有', () => {
    expect(fetchable(recalledFile, true)).toMatchObject({ kind: 'file', fileId: 'F1' });
    expect(fetchable(recalledFile, true)!.name('application/octet-stream')).toBe(NAME);
    expect(fetchable(deletedImage, true)).toMatchObject({ kind: 'image', fileId: 'F2' });
    expect(fetchable(deletedImage, true)!.name('image/jpeg')).toBe('图片-4.png'); // 正文里的类型优先
    const noMime = msg(6, { type: 'image', recalled: true, body: { image: { fileId: 'F5' } } });
    expect(fetchable(noMime, true)!.name('image/jpeg')).toBe('图片-6.jpg'); // 没有时用响应的 Content-Type
    expect(fetchable(noMime, true)!.name('')).toBe('图片-6.img');
    expect(fetchable(recalledFile, false)).toBeNull();
    expect(fetchable(liveFile, true)).toBeNull();
    expect(fetchable(expired, true)).toBeNull();
    expect(fetchable(msg(1, { recalled: true, body: { text: 'x' } }), true)).toBeNull();
    expect(fetchable(msg(1, { type: 'file', recalled: true, body: { file: { name: 'no-id' } } }), true)).toBeNull();
  });

  it('TC-RCL-04-09 下载用正文里的文件名；去掉路径分隔符；图片按类型取扩展名', () => {
    expect(downloadName('file', 1, '../a/b\\c.pdf')).toBe('.._a_b_c.pdf');
    expect(downloadName('file', 1, ' \u0001 ')).toBe('_');
    expect(downloadName('file', 1, '')).toBe('file');
    expect(downloadName('image', 7, undefined, 'image/jpeg')).toBe('图片-7.jpg');
    expect(downloadName('image', 7, undefined, 'application/x')).toBe('图片-7.img');
  });

  it('TC-RCL-04-09 点"下载查看"：POST 代理，文件名不进 URL 和请求；按正文的文件名另存；blob 地址及时撤销；不写日志', async () => {
    install(['msg.read.group', 'msg.quarantine.read']);
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    replies['POST /console/api/messages/body'] = [page([recalledFile, deletedImage, liveFile, expired])];
    replies['POST /console/api/files/F1/fetch'] = [{ body: null, bytes: '%PDF-1.4' }];
    open('/messages/body', { convId: 'group:g1', quarantine: true });
    const buttons = await screen.findAllByRole('button', { name: '下载查看' });
    expect(buttons).toHaveLength(2);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(buttons[0]!);
    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    const req = posts('/console/api/files/F1/fetch');
    expect(req).toHaveLength(1);
    expect(req[0]!.body).toEqual({ convId: 'group:g1', msgId: 'm5', variant: 'original' });
    expect(clicked[0]).toEqual({ href: created[0], download: NAME });
    for (const c of calls) {
      expect(c.path).not.toContain('ZXQ');
      expect(JSON.stringify(c.body ?? {})).not.toContain('ZXQ');
    }
    expect(document.querySelector('a[download]')).toBeNull(); // 用完就移除
    expect(revoked).toEqual([]);
    act(() => vi.advanceTimersByTime(REVOKE_AFTER_MS));
    expect(revoked).toEqual(created);
    expect(document.querySelector('.body-area img, .body-area iframe, .body-area object, .body-area embed')).toBeNull();
    for (const l of logs) for (const args of l.mock.calls) expect(JSON.stringify(args)).not.toContain('ZXQ');
  });

  it('TC-RCL-04-09 没有授权（4039）：弹"工单号 + 理由 + 动态码"，授权后接着下载这一个', async () => {
    install(['msg.read.group', 'msg.quarantine.read']);
    replies['POST /console/api/messages/body'] = [page([recalledFile])];
    replies['POST /console/api/files/F1/fetch'] = [
      { status: 403, body: { code: 4039 } },
      { body: null, bytes: 'x' },
    ];
    replies['POST /console/api/messages/grants'] = [{ body: { grantPrefix: 'abcd1234', expiresAt: T } }];
    open('/messages/body', { convId: 'group:g1', quarantine: true });
    await userEvent.click(await screen.findByRole('button', { name: '下载查看' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('查看隔离原文')).toBeVisible();
    expect(clicked).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText('工单号'), 'T-671');
    await userEvent.type(within(dialog).getByLabelText('理由'), '撤回文件取证核查');
    await userEvent.type(within(dialog).getByLabelText('动态码'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: '查看' }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.download).toBe(NAME);
    expect(posts('/console/api/messages/grants')[0]!.body).toEqual({
      convId: 'group:g1',
      ticket: 'T-671',
      reason: '撤回文件取证核查',
      otp: '123456',
      quarantine: true,
    });
    expect(posts('/console/api/files/F1/fetch')).toHaveLength(2);
  });

  it('TC-RCL-04-09 取消授权框不下载；4048 提示文件不存在；没有 Blob 地址', async () => {
    install(['msg.read.group', 'msg.quarantine.read']);
    replies['POST /console/api/messages/body'] = [page([recalledFile])];
    replies['POST /console/api/files/F1/fetch'] = [
      { status: 403, body: { code: 4039 } },
      { status: 404, body: { code: 4048 } },
    ];
    open('/messages/body', { convId: 'group:g1', quarantine: true });
    await userEvent.click(await screen.findByRole('button', { name: '下载查看' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: '下载查看' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('文件不存在或已过了保留期');
    expect(created).toEqual([]);
    expect(clicked).toEqual([]);
  });

  it('TC-RCL-04-09 apiBlob：带 CSRF、同源 Cookie；错误仍按 JSON 码；传到一半断了按网络错误', async () => {
    install([]);
    replies['POST /x/ok'] = [{ body: null, bytes: 'abc' }];
    replies['POST /x/bad'] = [{ status: 403, body: { code: 4039 } }];
    const blob = await apiBlob('POST', '/x/ok', { a: 1 });
    expect(blob.size).toBe(3);
    const init = vi.mocked(fetch).mock.calls.find((c) => c[0] === '/x/ok')![1]!;
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('t');
    expect(init.credentials).toBe('same-origin');
    await expect(apiBlob('POST', '/x/bad', {})).rejects.toMatchObject({ code: 4039 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const r = new Response('partial');
        vi.spyOn(r, 'blob').mockRejectedValue(new TypeError('network error'));
        return r;
      }),
    );
    const err = await apiBlob('POST', '/x/cut', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(NETWORK);
  });

  it('TC-RCL-04-09 saveBlob：创建隐藏链接、点击后移除，到点撤销同一个地址', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    saveBlob(new Blob(['x']), 'a.pdf');
    expect(clicked).toEqual([{ href: created[0], download: 'a.pdf' }]);
    expect(document.querySelector('a')).toBeNull();
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(created);
  });
});
