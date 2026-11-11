import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClient } from '../api/client';
import type { WordRow } from '../api/types';
import { App } from '../App';
import { parseWordFile, sceneLabel } from '../lib/moderation';
import { SessionProvider } from '../session';

// FE-696：词库页和命中统计（PRD-chat F-MOD-01、F-MOD-02 规则 7，第 14.1 节；CS-206）。
// 用真实的路由守卫、菜单、SessionProvider 和 API 客户端，只换 fetch。只用特征词 ZXQ-*。

const LIST = '/console/api/moderation/words';
type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply[]>;
let calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];

const T = Date.UTC(2026, 10, 11, 4, 5, 6);
const word = (over: Partial<WordRow> = {}): WordRow => ({
  wordId: 1,
  word: 'ZXQ-W-1',
  state: 'active',
  createdAt: T,
  updatedAt: T,
  ...over,
});

function install(perms: string[]) {
  const session = {
    account: { id: 'me', username: 'mo1', displayName: 'mo1', space: 'admin' },
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

const of = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

function open(perms = ['moderation.words', 'report.read']) {
  install(perms);
  return render(
    <MemoryRouter initialEntries={['/moderation/words']}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

const enc = (s: string) => new TextEncoder().encode(s);
const txt = (content: string | Uint8Array<ArrayBuffer>, name = 'words.txt') =>
  new File([typeof content === 'string' ? enc(content) : content], name, { type: 'text/plain' });

beforeEach(() => {
  replies = { [`GET ${LIST}`]: [{ body: { words: [word()], nextCursor: '' } }] };
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

describe('parseWordFile（frontend-chat 第 86 条）', () => {
  const parse = (s: string) => parseWordFile(enc(s).buffer as ArrayBuffer);
  it('一行一个，去首尾空白，空行保留给服务端计入无效；文件末尾的换行不算一行；去掉 BOM', () => {
    expect(parse('﻿ ZXQ-A \r\n\nZXQ-B\rZXQ-C\n')).toEqual(['ZXQ-A', '', 'ZXQ-B', 'ZXQ-C']);
    expect(parse('')).toEqual([]);
    expect(parse('ZXQ-A')).toEqual(['ZXQ-A']);
    expect(parse('ZXQ-A\n\n')).toEqual(['ZXQ-A', '']);
  });
  it('不是 UTF-8 返回 null', () => {
    expect(parseWordFile(new Uint8Array([0x5a, 0xff, 0xfe, 0x0a]).buffer)).toBeNull();
  });
  it('场景名', () => {
    expect(sceneLabel('text')).toBe('文本消息');
    expect(sceneLabel('friendApply')).toBe('好友申请附言');
    expect(sceneLabel('zzz')).toBe('zzz');
  });
});

describe('菜单和路由守卫（moderation.words，同 FE-401）', () => {
  it('有 moderation.words：菜单有"词库"，路由能进', async () => {
    open(['moderation.words']);
    expect(await screen.findByRole('heading', { name: '词库' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '主菜单' })).getByRole('link', { name: '词库' }),
    ).toHaveAttribute('href', '/moderation/words');
  });
  it('没有 moderation.words：菜单没有，路由显示没有权限，不请求词库', async () => {
    open(['user.read']);
    expect(await screen.findByRole('heading', { name: '无权限' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: '主菜单' })).queryByRole('link', { name: '词库' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith(LIST))).toBe(false);
  });
});

describe('AC-MOD-01-7 列表、搜索、添加、停用、删除', () => {
  it('原文按纯文本显示（含 HTML 的词不解析），显示状态和更新时间', async () => {
    replies[`GET ${LIST}`] = [
      {
        body: {
          words: [
            word({ wordId: 2, word: '<img src=x onerror=alert(1)>ZXQ-W-2', state: 'disabled' }),
            word({ wordId: 1 }),
          ],
          nextCursor: '',
        },
      },
    ];
    open();
    const table = await screen.findByRole('table', { name: '词库' });
    expect(within(table).getByText('<img src=x onerror=alert(1)>ZXQ-W-2')).toBeInTheDocument();
    expect(table.querySelector('img')).toBeNull();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('已停用');
    expect(within(rows[1]!).getByRole('button', { name: '启用' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('生效');
    expect(within(rows[2]!).getByRole('button', { name: '停用' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('2026/11/11 12:05:06');
  });

  it('搜索：q 进查询参数；翻页带 cursor', async () => {
    replies[`GET ${LIST}?q=ZXQ`] = [{ body: { words: [word()], nextCursor: '9' } }];
    replies[`GET ${LIST}?q=ZXQ&cursor=9`] = [
      { body: { words: [word({ wordId: 0, word: 'ZXQ-W-0' })], nextCursor: '' } },
    ];
    const user = userEvent.setup();
    open();
    await screen.findByRole('table', { name: '词库' });
    await user.type(screen.getByLabelText('搜索'), ' ZXQ ');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    await user.click(await screen.findByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('ZXQ-W-0')).toBeInTheDocument();
    expect(of('GET', `${LIST}?q=ZXQ&cursor=9`)).toHaveLength(1);
  });

  it('添加：POST 去首尾空白的词；已有的提示状态不变；超过 64 个字不能提交', async () => {
    replies[`POST ${LIST}`] = [
      { body: { word: word({ wordId: 3, word: 'ZXQ-W-3' }), created: true } },
      { body: { word: word({ wordId: 3, word: 'ZXQ-W-3' }), created: false } },
    ];
    const user = userEvent.setup();
    open();
    await screen.findByRole('table', { name: '词库' });
    const input = screen.getByLabelText('词');
    await user.type(input, '  ZXQ-W-3 ');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(await screen.findByText('已添加')).toBeInTheDocument();
    expect(of('POST', LIST)[0]!.body).toEqual({ word: 'ZXQ-W-3' });
    await user.type(input, 'ZXQ-W-3');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(await screen.findByText('词库里已有这个词，状态不变')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'Z'.repeat(65));
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled();
    expect(screen.getAllByText('最多 64 个字').length).toBeGreaterThan(0);
  });

  it('停用 / 启用要确认，PATCH state；删除要确认，DELETE', async () => {
    replies[`PATCH ${LIST}/1`] = [{ body: { word: word({ state: 'disabled' }) } }];
    replies[`DELETE ${LIST}/1`] = [{ body: {} }];
    const user = userEvent.setup();
    open();
    const table = await screen.findByRole('table', { name: '词库' });
    await user.click(within(table).getByRole('button', { name: '停用' }));
    let dlg = screen.getByRole('dialog', { name: '停用词' });
    expect(dlg).toHaveTextContent('将停用词 ZXQ-W-1');
    expect(of('PATCH', `${LIST}/1`)).toHaveLength(0);
    await user.click(within(dlg).getByRole('button', { name: '停用' }));
    await waitFor(() => expect(of('PATCH', `${LIST}/1`)).toHaveLength(1));
    expect(of('PATCH', `${LIST}/1`)[0]!.body).toEqual({ state: 'disabled' });

    await user.click(within(table).getByRole('button', { name: '删除' }));
    dlg = screen.getByRole('dialog', { name: '删除词' });
    await user.click(within(dlg).getByRole('button', { name: '取消' }));
    expect(of('DELETE', `${LIST}/1`)).toHaveLength(0);
    await user.click(within(table).getByRole('button', { name: '删除' }));
    await user.click(within(screen.getByRole('dialog', { name: '删除词' })).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(of('DELETE', `${LIST}/1`)).toHaveLength(1));
  });

  it('词列表不进本地存储', async () => {
    open();
    await screen.findByRole('table', { name: '词库' });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('AC-MOD-01-7 批量导入', () => {
  it('txt 拆成数组提交（确认后），显示新增、重复、无效', async () => {
    replies[`POST ${LIST}/import`] = [{ body: { added: 2, duplicate: 1, invalid: 1 } }];
    const user = userEvent.setup();
    open();
    await screen.findByRole('table', { name: '词库' });
    await user.upload(screen.getByLabelText('选择文件'), txt('ZXQ-A\n ZXQ-B \n\nZXQ-A\n'));
    const dlg = await screen.findByRole('dialog', { name: '批量导入' });
    expect(dlg).toHaveTextContent('将导入 4 行');
    expect(of('POST', `${LIST}/import`)).toHaveLength(0);
    await user.click(within(dlg).getByRole('button', { name: '导入' }));
    expect(await screen.findByText('导入完成：新增 2，重复 1，无效 1')).toBeInTheDocument();
    expect(of('POST', `${LIST}/import`)[0]!.body).toEqual({ words: ['ZXQ-A', 'ZXQ-B', '', 'ZXQ-A'] });
    // 导入后重新加载列表。
    await waitFor(() => expect(of('GET', LIST).length).toBeGreaterThan(1));
  });

  it('超过 5000 行直接提示"一次最多 5000 条"，不提交', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table', { name: '词库' });
    const lines = Array.from({ length: 5001 }, (_, i) => `ZXQ-${i}`).join('\n');
    await user.upload(screen.getByLabelText('选择文件'), txt(lines));
    expect(await screen.findByText('一次最多 5000 条')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(of('POST', `${LIST}/import`)).toHaveLength(0);
  });

  it('正好 5000 行可以提交', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table', { name: '词库' });
    const lines = Array.from({ length: 5000 }, (_, i) => `ZXQ-${i}`).join('\n');
    await user.upload(screen.getByLabelText('选择文件'), txt(lines));
    expect(await screen.findByRole('dialog', { name: '批量导入' })).toHaveTextContent('将导入 5000 行');
  });

  it('不是 UTF-8 的文件提示，不提交', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table', { name: '词库' });
    await user.upload(screen.getByLabelText('选择文件'), txt(new Uint8Array([0xd6, 0xd0, 0x0a])));
    expect(await screen.findByText('文件不是 UTF-8 编码')).toBeInTheDocument();
    expect(of('POST', `${LIST}/import`)).toHaveLength(0);
  });
});

describe('命中统计（P-48 ③：只对有 report.read 的显示）', () => {
  it('有 report.read：按用户查，显示按场景的次数和最近记录（时间、场景、词 ID）', async () => {
    replies['GET /console/api/moderation/hits?userId=u1'] = [
      {
        body: {
          userId: 'u1',
          days: 90,
          counts: { text: 3, nickname: 1 },
          recent: [{ at: T, scene: 'text', wordId: 7 }],
        },
      },
    ];
    const user = userEvent.setup();
    open(['moderation.words', 'report.read']);
    expect(await screen.findByRole('heading', { name: '命中统计' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('用户 ID'), 'u1');
    await user.click(screen.getByRole('button', { name: '查询次数' }));
    const counts = await screen.findByRole('table', { name: '按场景的命中次数' });
    expect(
      within(counts)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual(['场景次数', '文本消息3', '昵称1']);
    const recent = screen.getByRole('table', { name: '最近的命中' });
    expect(within(recent).getAllByRole('row')[1]).toHaveTextContent('2026/11/11 12:05:06文本消息7');
    expect(screen.getByText(/最近 90 天的命中次数/)).toBeInTheDocument();
  });

  it('只有 moderation.words（运营）：没有命中统计，不请求', async () => {
    open(['moderation.words']);
    await screen.findByRole('table', { name: '词库' });
    expect(screen.queryByRole('heading', { name: '命中统计' })).toBeNull();
    expect(screen.queryByLabelText('用户 ID')).toBeNull();
    expect(calls.some((c) => c.path.includes('/moderation/hits'))).toBe(false);
  });
});
