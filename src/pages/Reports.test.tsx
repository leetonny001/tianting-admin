import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClient } from '../api/client';
import type { Evidence, ReportDetail, ReportItem } from '../api/types';
import { App } from '../App';
import { toLocalInput } from '../lib/format';
import { dataUrl, inlineImage, reasonLabel, targetText } from '../lib/moderation';
import { SessionProvider } from '../session';
import { watermarkText } from './MessageBody';

// FE-697：举报队列、详情、证据、结案（PRD-chat F-MOD-04，第 14.1 节；CS-207、CS-208）。
// 用真实的路由守卫、菜单、SessionProvider 和 API 客户端，只换 fetch 和 blob 地址。只用特征串 ZXQ-*。

type Reply = { status?: number; body?: unknown; bytes?: Uint8Array; type?: string };
let replies: Record<string, Reply[]>;
let calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
let saved: { download: string }[];

const MOD = [
  'report.read',
  'report.handle',
  'report.evidence',
  'msg.delete',
  'mute.write',
  'user.ban',
  'user.kick',
  'group.dissolve',
];
const LIST = '/console/api/reports';
const R = '/console/api/reports/r1';
const T = Date.UTC(2026, 10, 11, 4, 5, 6);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SCRIPT_NAME = '<script>alert(1)</script>ZXQ-RPT.html';

function install(perms: string[]) {
  const session = {
    account: { id: 'me', username: 'mod1', displayName: 'mod1', space: 'admin' },
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
      const key = `${method} ${path}${body?.variant ? ` ${body.variant}` : ''}`;
      const q = replies[key];
      const r = q?.length && q.length > 1 ? q.shift()! : q?.[0];
      if (!r) return new Response(JSON.stringify({ code: 4040 }), { status: 404 });
      if (r.bytes)
        return new Response(r.bytes as BodyInit, {
          status: 200,
          headers: { 'Content-Type': r.type ?? 'application/octet-stream' },
        });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
}

const of = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{`${loc.pathname} ${JSON.stringify(loc.state)}`}</div>;
}

function open(entry: string | { pathname: string; state: unknown }, perms = MOD) {
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

const item = (over: Partial<ReportItem> = {}): ReportItem => ({
  targetKey: 'k-user-u1',
  targetType: 'user',
  userId: 'u1',
  count: 1,
  latestAt: T,
  reports: [{ reportId: 'r1', reason: 'abuse', state: 'pending', createdAt: T }],
  ...over,
});

const detail = (over: Partial<ReportDetail> = {}): ReportDetail => ({
  reportId: 'r1',
  targetType: 'message',
  convType: 'group',
  convId: 'group:g1',
  msgIds: ['m1', 'm2', 'm3'],
  reporter: 'u2',
  targetUser: 'u1',
  targetReportCount: 5,
  reason: 'abuse',
  state: 'pending',
  createdAt: T,
  messages: [
    { msgId: 'm1', seq: 3, from: 'u1', type: 'text', bodyLength: 12 },
    { msgId: 'm2', seq: 4, from: 'u1', type: 'image', bodyLength: 0, fileSize: 2048 },
    { msgId: 'm3', seq: 5, from: 'u1', type: 'file', bodyLength: 0, fileSize: 10 },
  ],
  ...over,
});

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  grantPrefix: 'gr8abcde',
  expiresAt: T + 900_000,
  note: 'ZXQ-NOTE 补充 <b>x</b>',
  messages: [
    {
      msgId: 'm1',
      seq: 3,
      from: 'u1',
      type: 'text',
      ts: T,
      body: { text: 'ZXQ-RPT-1 撤回的原话' },
      recalled: true,
      recalledAt: T + 1000,
      recalledBy: 'u1',
    },
    {
      msgId: 'm2',
      seq: 4,
      from: 'u1',
      type: 'image',
      ts: T,
      body: { image: { fileId: 'f-img', width: 64, height: 48, size: 2048, mime: 'image/png' } },
    },
    {
      msgId: 'm3',
      seq: 5,
      from: 'u1',
      type: 'file',
      ts: T,
      body: { file: { fileId: 'f-html', name: SCRIPT_NAME, size: 10, mime: 'text/html' } },
    },
  ],
  ...over,
});

beforeEach(() => {
  replies = {};
  calls = [];
  saved = [];
  resetClient();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ download: this.download });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('纯函数', () => {
  it('理由文案（frontend-chat 第 78 条）', () => {
    expect(['spam', 'abuse', 'porn', 'fraud', 'illegal', 'other'].map(reasonLabel)).toEqual([
      '垃圾广告',
      '辱骂骚扰',
      '色情低俗',
      '诈骗',
      '违法违规',
      '其他',
    ]);
  });
  it('举报对象：单聊消息没有 convId 时写"打开时填写理由"', () => {
    expect(targetText({ targetType: 'message', convType: 'c2c' })).toBe('单聊消息（打开时填写理由）');
    expect(targetText({ targetType: 'message', convType: 'group', convId: 'group:g', msgIds: ['m1'] })).toBe(
      '群消息 group:g / m1',
    );
    expect(targetText({ targetType: 'group', groupId: 'g' })).toBe('群 g');
  });
  it('只有白名单里的图片类型内联；data: 地址按类型拼', async () => {
    expect(inlineImage('image/png')).toBe(true);
    expect(inlineImage('image/svg+xml')).toBe(false);
    expect(inlineImage('text/html')).toBe(false);
    expect(inlineImage('application/octet-stream')).toBe(false);
    expect(await dataUrl(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))).toBe(
      'data:image/png;base64,AQID',
    );
  });
});

describe('队列（AC-MOD-04-6）', () => {
  it('菜单和路由按 report.read；没有的看不到', async () => {
    replies[`GET ${LIST}`] = [{ body: { items: [], nextCursor: '' } }];
    open('/reports', ['report.read']);
    expect(await screen.findByRole('heading', { name: '举报' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: '主菜单' })).getByRole('link', { name: '举报' }),
    ).toHaveAttribute('href', '/reports');
    cleanup();
    calls = [];
    open('/reports', ['moderation.words']);
    expect(await screen.findByRole('heading', { name: '无权限' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: '主菜单' })).queryByRole('link', { name: '举报' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith(LIST))).toBe(false);
  });

  it('同一对象 3 条聚合显示"3 次"，点开看每条（理由、状态、时间），链接到举报单', async () => {
    replies[`GET ${LIST}`] = [
      {
        body: {
          items: [
            item({
              count: 3,
              reports: [
                { reportId: 'r3', reason: 'spam', state: 'pending', createdAt: T + 2000 },
                { reportId: 'r2', reason: 'abuse', state: 'handled', createdAt: T + 1000 },
                { reportId: 'r1', reason: 'other', state: 'rejected', createdAt: T },
              ],
            }),
          ],
          nextCursor: '',
        },
      },
    ];
    const user = userEvent.setup();
    open('/reports');
    const table = await screen.findByRole('table', { name: '举报队列' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('用户 u1');
    expect(row).toHaveTextContent('3 次');
    expect(within(row).queryByRole('list')).toBeNull();
    await user.click(within(row).getByRole('button', { name: '查看每条' }));
    const each = within(row).getByRole('list', { name: '每条举报' });
    expect(
      within(each)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'r3 垃圾广告 · 待处理 · 2026/11/11 12:05:08',
      'r2 辱骂骚扰 · 已处理 · 2026/11/11 12:05:07',
      'r1 其他 · 已驳回 · 2026/11/11 12:05:06',
    ]);
    expect(within(each).getByRole('link', { name: 'r2' })).toHaveAttribute('href', '/reports/r2');
    // 打开举报单才写审计：队列只请求列表。
    expect(calls.filter((c) => c.path.startsWith(LIST)).map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${LIST}`]);
  });

  it('对象按纯文本显示；单聊消息没有 convId、msgIds', async () => {
    replies[`GET ${LIST}`] = [
      {
        body: {
          items: [
            item({ targetKey: 'k1', targetType: 'message', convType: 'c2c', userId: undefined }),
            item({
              targetKey: 'k2',
              targetType: 'message',
              convType: 'group',
              convId: 'group:<b>g</b>',
              msgIds: ['m1'],
              userId: undefined,
            }),
          ],
          nextCursor: '',
        },
      },
    ];
    open('/reports');
    const table = await screen.findByRole('table', { name: '举报队列' });
    expect(table).toHaveTextContent('单聊消息（打开时填写理由）');
    expect(table).toHaveTextContent('群消息 group:<b>g</b> / m1');
    expect(table.querySelector('b')).toBeNull();
  });

  it('按状态、理由、时间筛选：进查询参数（毫秒）', async () => {
    replies[`GET ${LIST}`] = [{ body: { items: [], nextCursor: '' } }];
    const from = Date.UTC(2026, 10, 1, 0, 0);
    const to = Date.UTC(2026, 10, 2, 0, 0);
    const user = userEvent.setup();
    open('/reports');
    await screen.findByText('没有举报');
    await user.selectOptions(screen.getByLabelText('状态'), '已驳回');
    await user.selectOptions(screen.getByLabelText('理由'), '诈骗');
    await user.type(screen.getByLabelText('开始时间'), toLocalInput(from));
    await user.type(screen.getByLabelText('结束时间'), toLocalInput(to));
    await user.click(screen.getByRole('button', { name: '筛选' }));
    await waitFor(() =>
      expect(calls.map((c) => c.path)).toContain(`${LIST}?state=rejected&reason=fraud&from=${from}&to=${to}`),
    );
  });
});

describe('举报单：打开（POST view）和元数据', () => {
  it('群消息举报：POST .../view，不用 GET；显示举报人、被举报人、总次数、理由、消息类型和长度；没有 note、文件名', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    open('/reports/r1');
    expect(await screen.findByText('该用户被举报的总次数')).toBeInTheDocument();
    expect(of('POST', `${R}/view`)).toHaveLength(1);
    expect(of('POST', `${R}/view`)[0]!.body).toEqual({});
    expect(calls.some((c) => c.method === 'GET' && c.path.startsWith(R))).toBe(false);
    const kv = document.querySelector('dl.kv')!;
    expect(kv).toHaveTextContent('举报人u2');
    expect(kv).toHaveTextContent('被举报人u1');
    expect(kv).toHaveTextContent('该用户被举报的总次数5 次');
    expect(kv).toHaveTextContent('理由辱骂骚扰');
    expect(kv).toHaveTextContent('状态待处理');
    const rows = within(screen.getByRole('table', { name: '被举报的消息' })).getAllByRole('row');
    expect(rows.slice(1).map((r) => r.textContent)).toEqual(['m1u1文本12', 'm2u1图片2 KB', 'm3u1文件10 B']);
    expect(document.body).not.toHaveTextContent('补充说明');
    expect(document.body).not.toHaveTextContent('ZXQ-RPT');
  });

  it('单聊消息举报（从队列进来）：先填理由，填之前不请求；理由和工单号进请求体', async () => {
    replies[`POST ${R}/view`] = [{ body: detail({ convType: 'c2c', convId: 'c2c:u1:u2' }) }];
    const user = userEvent.setup();
    open({ pathname: '/reports/r1', state: { c2c: true } });
    const dlg = await screen.findByRole('dialog', { name: '查看单聊举报' });
    expect(dlg).toHaveTextContent('每天 50 个会话');
    expect(of('POST', `${R}/view`)).toHaveLength(0);
    await user.type(within(dlg).getByLabelText('理由'), '核实用户举报');
    await user.type(within(dlg).getByLabelText('工单号（可选）'), 'T-1');
    await user.click(within(dlg).getByRole('button', { name: '查看' }));
    expect(await screen.findByText('该用户被举报的总次数')).toBeInTheDocument();
    expect(of('POST', `${R}/view`)[0]!.body).toEqual({ reason: '核实用户举报', ticket: 'T-1' });
    expect(calls.some((c) => c.path.includes('?') && c.path.includes('核实'))).toBe(false);
  });

  it('超过每天 50 个（429 / 4292）：框里提示，不显示元数据', async () => {
    replies[`POST ${R}/view`] = [{ status: 429, body: { code: 4292 } }];
    const user = userEvent.setup();
    open({ pathname: '/reports/r1', state: { c2c: true } });
    const dlg = await screen.findByRole('dialog', { name: '查看单聊举报' });
    await user.type(within(dlg).getByLabelText('理由'), '核实用户举报');
    await user.click(within(dlg).getByRole('button', { name: '查看' }));
    expect(await within(dlg).findByText('今天的查询次数已达上限')).toBeInTheDocument();
    expect(screen.queryByText('举报人')).toBeNull();
  });

  it('直接打开链接、是单聊（400 / 4000 reasonInvalid）：补问理由', async () => {
    replies[`POST ${R}/view`] = [
      { status: 400, body: { code: 4000, reason: 'reasonInvalid' } },
      { body: detail({ convType: 'c2c', convId: 'c2c:u1:u2' }) },
    ];
    const user = userEvent.setup();
    open('/reports/r1');
    const dlg = await screen.findByRole('dialog', { name: '查看单聊举报' });
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(within(dlg).getByLabelText('理由'), '核实用户举报');
    await user.click(within(dlg).getByRole('button', { name: '查看' }));
    expect(await screen.findByText('举报人')).toBeInTheDocument();
    expect(of('POST', `${R}/view`).map((c) => c.body)).toEqual([{}, { reason: '核实用户举报' }]);
  });

  it('没有 report.evidence 看不到证据；没有 report.handle 不能结案', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    open('/reports/r1', ['report.read']);
    expect(await screen.findByText('举报人')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看证据' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '结案' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '处置' })).toBeNull();
  });
});

describe('证据（AC-MOD-03-11、04-12、04-15）', () => {
  async function openEvidence(ev: Evidence = evidence()) {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    replies[`POST ${R}/evidence`] = [{ status: 403, body: { code: 4039 } }, { body: ev }];
    replies[`POST ${R}/evidence-grant`] = [{ body: { grantPrefix: 'gr8abcde', expiresAt: T + 900_000 } }];
    replies[`POST ${R}/files/f-img/fetch thumb`] = [{ bytes: PNG, type: 'image/png' }];
    replies[`POST ${R}/files/f-img/fetch original`] = [{ bytes: PNG, type: 'image/png' }];
    replies[`POST ${R}/files/f-html/fetch original`] = [{ bytes: new Uint8Array([60, 104]), type: 'text/html' }];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    const dlg = await screen.findByRole('dialog', { name: '查看举报证据' });
    const ticket = within(dlg).getByLabelText('工单号');
    expect(ticket).toHaveValue('r1');
    expect(ticket).toHaveAttribute('readonly');
    await user.type(ticket, 'X');
    expect(ticket).toHaveValue('r1');
    await user.type(within(dlg).getByLabelText('理由'), '核实举报证据');
    await user.type(within(dlg).getByLabelText('动态码'), '123456');
    await user.click(within(dlg).getByRole('button', { name: '查看' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    return user;
  }

  it('先读，4039 弹授权框（理由 + 当次动态码，工单号是举报 ID 不能改）；授权后显示原文、隔离原文、补充说明、文件名，平铺水印', async () => {
    await openEvidence();
    expect(of('POST', `${R}/evidence-grant`)[0]!.body).toEqual({ reason: '核实举报证据', otp: '123456' });
    expect(await screen.findByText('ZXQ-RPT-1 撤回的原话')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && /^已撤回（u1，.+），以下是隔离原文$/.test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('补充说明：ZXQ-NOTE 补充 <b>x</b>')).toBeInTheDocument();
    // 文件名含 <script> 按纯文本（AC-MOD-04-15）。
    expect(screen.getByText(`[文件] ${SCRIPT_NAME}，10 B`)).toBeInTheDocument();
    expect(document.querySelector('script, b, iframe, object, embed')).toBeNull();
    const wm = screen.getByTestId('watermark');
    expect(wm.querySelectorAll('span').length).toBeGreaterThan(10);
    expect(wm.querySelector('span')!.textContent).toBe(watermarkText('mod1', Date.now(), 'gr8abcde'));
    // 读证据、授权的请求体里没有理由以外的东西；URL 里没有理由。
    expect(calls.some((c) => c.path.includes('核实'))).toBe(false);
  });

  it('图片同时显示缩略图和原图：经 console 同源 POST 取，data: 地址显示，不用 blob:', async () => {
    await openEvidence();
    const thumb = await screen.findByRole('img', { name: '缩略图' });
    const orig = await screen.findByRole('img', { name: '原图' });
    expect(thumb.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(orig.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(
      calls.filter((c) => c.path === `${R}/files/f-img/fetch`).map((c) => [c.method, c.body?.msgId, c.body?.variant]),
    ).toEqual([
      ['POST', 'm2', 'thumb'],
      ['POST', 'm2', 'original'],
    ]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('html 文件只有"下载"（attachment），不内联；文件名不进 URL', async () => {
    const user = await openEvidence();
    await screen.findByRole('img', { name: '原图' });
    expect(document.querySelectorAll('img')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.download).toBe('<script>alert(1)<_script>ZXQ-RPT.html');
    expect(of('POST', `${R}/files/f-html/fetch`)[0]!.body).toEqual({ msgId: 'm3', variant: 'original' });
    expect(calls.some((c) => c.path.includes('ZXQ-RPT'))).toBe(false);
  });

  it('console 没按图片返回（伪造的图片，octet-stream）：不显示，只给下载', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    replies[`POST ${R}/evidence`] = [{ body: evidence({ messages: [evidence().messages[1]!] }) }];
    replies[`POST ${R}/files/f-img/fetch thumb`] = [{ bytes: PNG, type: 'application/octet-stream' }];
    replies[`POST ${R}/files/f-img/fetch original`] = [{ bytes: PNG, type: 'application/octet-stream' }];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    expect(await screen.findAllByRole('button', { name: '下载' })).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();
  });

  it('取文件 4039（授权过期）：弹同一个授权框', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    replies[`POST ${R}/evidence`] = [{ body: evidence({ messages: [evidence().messages[2]!] }) }];
    replies[`POST ${R}/files/f-html/fetch original`] = [{ status: 403, body: { code: 4039 } }];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    await user.click(await screen.findByRole('button', { name: '下载' }));
    expect(await screen.findByRole('dialog', { name: '查看举报证据' })).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('单聊（c2cBodyDisabled）：显示"单聊正文查看未开启"，只能看元数据和被举报次数', async () => {
    replies[`POST ${R}/view`] = [{ body: detail({ convType: 'c2c', convId: 'c2c:u1:u2' }) }];
    replies[`POST ${R}/evidence`] = [{ status: 403, body: { code: 4039 } }];
    replies[`POST ${R}/evidence-grant`] = [{ status: 403, body: { code: 4030, reason: 'c2cBodyDisabled' } }];
    const user = userEvent.setup();
    open({ pathname: '/reports/r1', state: { c2c: true } });
    const ask = await screen.findByRole('dialog', { name: '查看单聊举报' });
    await user.type(within(ask).getByLabelText('理由'), '核实用户举报');
    await user.click(within(ask).getByRole('button', { name: '查看' }));
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    const dlg = await screen.findByRole('dialog', { name: '查看举报证据' });
    await user.type(within(dlg).getByLabelText('理由'), '核实举报证据');
    await user.type(within(dlg).getByLabelText('动态码'), '123456');
    await user.click(within(dlg).getByRole('button', { name: '查看' }));
    expect(await screen.findByText('单聊正文查看未开启')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看证据' })).toBeNull();
    expect(of('POST', `${R}/evidence`)).toHaveLength(1);
    expect(screen.getByText('该用户被举报的总次数')).toBeInTheDocument();
  });

  it('读证据时单聊开关关闭（403 c2cBodyDisabled）：同样提示', async () => {
    replies[`POST ${R}/view`] = [{ body: detail({ targetType: 'user', convType: undefined, convId: undefined }) }];
    replies[`POST ${R}/evidence`] = [{ status: 403, body: { code: 4030, reason: 'c2cBodyDisabled' } }];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    expect(await screen.findByText('单聊正文查看未开启')).toBeInTheDocument();
  });

  it('undecryptable：显示"证据无法解密"，仍可结案', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    replies[`POST ${R}/evidence`] = [
      { body: { messages: [], undecryptable: true, grantPrefix: 'gr8abcde', expiresAt: T } },
    ];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    expect(await screen.findByText('证据无法解密')).toBeInTheDocument();
    expect(screen.queryByText('证据里没有消息')).toBeNull();
    expect(screen.getByRole('button', { name: '已处理' })).toBeEnabled();
  });

  it('只有元数据的消息：写明没有正文', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    replies[`POST ${R}/evidence`] = [
      { body: evidence({ note: undefined, messages: [{ msgId: 'm1', seq: 3, from: 'u1', type: 'text', ts: T }] }) },
    ];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '查看证据' }));
    expect(await screen.findByText('没有正文，只有元数据')).toBeInTheDocument();
    expect(screen.queryByText(/补充说明/)).toBeNull();
  });
});

describe('结案（F-MOD-04 规则 5，AC-MOD-04-5）', () => {
  it('结论 + 理由：POST resolve，成功后刷新举报单', async () => {
    replies[`POST ${R}/view`] = [
      { body: detail() },
      { body: detail({ state: 'handled', handledBy: 'console:admin:me', handledAt: T, conclusion: '已删除违规消息' }) },
    ];
    replies[`POST ${R}/resolve`] = [{ body: {} }];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '已处理' }));
    const dlg = screen.getByRole('dialog', { name: '结案：已处理' });
    expect(dlg).toHaveTextContent('不会自动删除消息');
    await user.type(within(dlg).getByLabelText('理由'), '已删除违规消息');
    await user.click(within(dlg).getByRole('button', { name: '已处理' }));
    expect(await screen.findByText('已结案')).toBeInTheDocument();
    expect(of('POST', `${R}/resolve`)[0]!.body).toEqual({ result: 'handled', reason: '已删除违规消息' });
    expect(await screen.findByText('结论')).toBeInTheDocument();
    expect(document.querySelector('dl.kv')).toHaveTextContent('状态已处理');
    expect(screen.queryByRole('heading', { name: '结案' })).toBeNull();
  });

  it('驳回', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    replies[`POST ${R}/resolve`] = [{ body: {} }];
    const user = userEvent.setup();
    open('/reports/r1');
    await user.click(await screen.findByRole('button', { name: '驳回' }));
    const dlg = screen.getByRole('dialog', { name: '结案：驳回' });
    await user.type(within(dlg).getByLabelText('理由'), '内容不违规');
    await user.click(within(dlg).getByRole('button', { name: '驳回' }));
    await waitFor(() => expect(of('POST', `${R}/resolve`)).toHaveLength(1));
    expect(of('POST', `${R}/resolve`)[0]!.body).toEqual({ result: 'rejected', reason: '内容不违规' });
  });

  it('4098：提示"举报已被处理"并刷新（单聊用打开时的理由，不再问）', async () => {
    replies[`POST ${R}/view`] = [
      { body: detail({ convType: 'c2c', convId: 'c2c:u1:u2' }) },
      { body: detail({ convType: 'c2c', convId: 'c2c:u1:u2', state: 'rejected', conclusion: '别人驳回' }) },
    ];
    replies[`POST ${R}/resolve`] = [{ status: 409, body: { code: 4098 } }];
    const user = userEvent.setup();
    open({ pathname: '/reports/r1', state: { c2c: true } });
    const ask = await screen.findByRole('dialog', { name: '查看单聊举报' });
    await user.type(within(ask).getByLabelText('理由'), '核实用户举报');
    await user.click(within(ask).getByRole('button', { name: '查看' }));
    await user.click(await screen.findByRole('button', { name: '已处理' }));
    const dlg = screen.getByRole('dialog', { name: '结案：已处理' });
    await user.type(within(dlg).getByLabelText('理由'), '已删除违规消息');
    await user.click(within(dlg).getByRole('button', { name: '已处理' }));
    expect(await screen.findByText('举报已被处理')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('dl.kv')).toHaveTextContent('状态已驳回'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(of('POST', `${R}/view`).map((c) => c.body)).toEqual([
      { reason: '核实用户举报' },
      { reason: '核实用户举报' },
    ]);
  });

  it('跳转已有操作只是链接（删除消息、禁言、封禁、强制下线、解散群），不发任何处置请求', async () => {
    replies[`POST ${R}/view`] = [{ body: detail() }];
    const user = userEvent.setup();
    open('/reports/r1');
    const links = within(await screen.findByRole('list', { name: '处置' })).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['删除消息', '/messages/body'],
      ['禁言', '/users/u1'],
      ['封禁', '/users/u1'],
      ['强制下线', '/users/u1'],
      ['解散群', '/groups/g1'],
    ]);
    const before = calls.length;
    await user.click(links[0]!);
    expect(screen.getByTestId('where')).toHaveTextContent('/messages/body {"convId":"group:g1"}');
    // 到了正文页也只是读（要再授权）；没有删除、禁言、封禁、下线、解散、结案的请求。
    expect(calls.slice(before).filter((c) => /delete|mute|ban|kick|dissolve|resolve/.test(c.path))).toEqual([]);
  });
});
